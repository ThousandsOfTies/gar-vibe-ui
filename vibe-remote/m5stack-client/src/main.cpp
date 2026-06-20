#include <Arduino.h>
#include <WiFi.h>
#include <ESPmDNS.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>

#ifndef VIBE_TRANSPORT_SPP
#define VIBE_TRANSPORT_SPP 0
#endif

#if VIBE_TRANSPORT_SPP
#include <BluetoothSerial.h>
#endif

#if __has_include(<M5Unified.h>)
#include <M5Unified.h>
#define HAS_M5UNIFIED 1
#else
#define HAS_M5UNIFIED 0
#endif

#ifndef VIBE_WIFI_SSID
#define VIBE_WIFI_SSID ""
#endif

#ifndef VIBE_WIFI_PASS
#define VIBE_WIFI_PASS ""
#endif

#ifndef VIBE_REMOTE_TOKEN
#define VIBE_REMOTE_TOKEN ""
#endif

#ifndef VIBE_SERVICE_TYPE
#define VIBE_SERVICE_TYPE "vibe-remote"
#endif

#ifndef VIBE_REMOTE_HOST
#define VIBE_REMOTE_HOST ""
#endif

#ifndef VIBE_REMOTE_PORT
#define VIBE_REMOTE_PORT 39271
#endif

#ifndef VIBE_DEVICE_NAME
#define VIBE_DEVICE_NAME "M5 Vibe Remote"
#endif

namespace {
constexpr uint32_t kWifiTimeoutMs = 20000;
constexpr uint32_t kReconnectIntervalMs = 3000;
constexpr uint32_t kPingIntervalMs = 5000;
constexpr uint32_t kDiscoverIntervalMs = 10000;
constexpr uint32_t kUiRefreshIntervalMs = 500;
constexpr uint32_t kToastDurationMs = 2600;

const char* kWifiSsid = VIBE_WIFI_SSID;
const char* kWifiPass = VIBE_WIFI_PASS;
const char* kToken = VIBE_REMOTE_TOKEN;
const char* kServiceType = VIBE_SERVICE_TYPE;
const char* kFallbackHost = VIBE_REMOTE_HOST;
const char* kDeviceName = VIBE_DEVICE_NAME;

WebSocketsClient ws;

#if VIBE_TRANSPORT_SPP
BluetoothSerial SerialBT;
#endif

String remoteHost;
uint16_t remotePort = VIBE_REMOTE_PORT;
String sppRxBuffer;
String lastToast;
String lastError;
String chatState = "idle";
String agentSource = "-";
String agentStatus = "idle";
String agentMessage = "";
String activityLine = "";

unsigned long lastReconnectAttempt = 0;
unsigned long lastPingAt = 0;
unsigned long lastDiscoverAt = 0;
unsigned long lastUiRefreshAt = 0;
unsigned long toastUntil = 0;

bool wifiReady = false;
bool mdnsReady = false;
bool wsConnected = false;
bool sppConnected = false;
bool tokenReady = false;
bool displayDirty = true;

void logLine(const String& line) {
  Serial.println(line);
}

void showToast(const String& line) {
  lastToast = line;
  toastUntil = millis() + kToastDurationMs;
  displayDirty = true;
  logLine(line);
}

uint16_t colorForStatus(const String& status) {
#if HAS_M5UNIFIED
  if (status == "running" || status == "working") {
    return TFT_CYAN;
  }
  if (status == "waiting" || status == "maybeWaiting") {
    return TFT_YELLOW;
  }
  if (status == "done") {
    return TFT_GREEN;
  }
  if (status == "failed" || status == "disconnected") {
    return TFT_RED;
  }
  return TFT_DARKGREY;
#else
  (void)status;
  return 0;
#endif
}

String shortText(const String& text, size_t maxLen) {
  if (text.length() <= maxLen) {
    return text;
  }
  return text.substring(0, maxLen - 1) + ".";
}

void drawDashboard() {
#if HAS_M5UNIFIED
  M5.Display.fillScreen(TFT_BLACK);
  M5.Display.setTextSize(2);

  M5.Display.fillRect(0, 0, M5.Display.width(), 32, TFT_NAVY);
  M5.Display.setTextColor(TFT_WHITE, TFT_NAVY);
  M5.Display.drawString("Vibe Remote", 8, 7);

  M5.Display.setTextSize(1);
  M5.Display.setTextColor(TFT_LIGHTGREY, TFT_NAVY);
  M5.Display.drawString(kDeviceName, M5.Display.width() - 108, 11);

  const uint16_t statusColor = colorForStatus(agentStatus != "idle" ? agentStatus : chatState);
  M5.Display.fillRoundRect(10, 44, M5.Display.width() - 20, 54, 8, statusColor);
  M5.Display.setTextColor(TFT_BLACK, statusColor);
  M5.Display.setTextSize(2);
  M5.Display.drawString(shortText(agentStatus, 14), 20, 54);
  M5.Display.setTextSize(1);
  M5.Display.drawString("chat: " + chatState, 22, 78);

  M5.Display.setTextColor(TFT_WHITE, TFT_BLACK);
  M5.Display.setTextSize(1);
  int y = 112;
#if VIBE_TRANSPORT_SPP
  M5.Display.drawString(String("BT  : ") + kDeviceName, 12, y);
  y += 16;
  M5.Display.drawString(String("SPP : ") + (sppConnected ? "connected" : "waiting"), 12, y);
  y += 16;
#else
  M5.Display.drawString(String("WiFi: ") + (wifiReady ? WiFi.localIP().toString() : "not connected"), 12, y);
  y += 16;
  M5.Display.drawString(String("Hub : ") + (remoteHost.length() ? remoteHost + ":" + String(remotePort) : "not found"), 12, y);
  y += 16;
  M5.Display.drawString(String("WS  : ") + (wsConnected ? "connected" : "disconnected"), 12, y);
  y += 16;
#endif
  M5.Display.drawString(String("Agent: ") + shortText(agentSource, 18), 12, y);
  y += 16;
  M5.Display.drawString(String("Msg : ") + shortText(agentMessage, 30), 12, y);
  y += 16;
  M5.Display.drawString(String("Act : ") + shortText(activityLine, 30), 12, y);
  y += 16;
  if (lastError.length() > 0) {
    M5.Display.setTextColor(TFT_RED, TFT_BLACK);
    M5.Display.drawString(String("Err : ") + shortText(lastError, 30), 12, y);
  }

  M5.Display.drawFastHLine(0, M5.Display.height() - 38, M5.Display.width(), TFT_DARKGREY);
  M5.Display.setTextColor(TFT_LIGHTGREY, TFT_BLACK);
  M5.Display.drawString("A Run  B Wait  C Done", 10, M5.Display.height() - 32);
  M5.Display.drawString("Hold A Fail / B Idle / C Reconnect", 10, M5.Display.height() - 18);

  if (millis() < toastUntil && lastToast.length() > 0) {
    M5.Display.fillRoundRect(12, M5.Display.height() - 72, M5.Display.width() - 24, 26, 6, TFT_DARKGREY);
    M5.Display.setTextColor(TFT_WHITE, TFT_DARKGREY);
    M5.Display.drawString(shortText(lastToast, 34), 20, M5.Display.height() - 65);
  }
#endif
}

void markDirty() {
  displayDirty = true;
}

void sendJson(JsonDocument& doc) {
#if VIBE_TRANSPORT_SPP
  if (!sppConnected) {
    showToast("SPP is not connected");
    return;
  }

  String payload;
  serializeJson(doc, payload);
  SerialBT.println(payload);
#else
  if (!wsConnected) {
    showToast("WS is not connected");
    return;
  }

  String payload;
  serializeJson(doc, payload);
  ws.sendTXT(payload);
#endif
}

void sendHello() {
  JsonDocument doc;
  doc["type"] = "hello";
  doc["token"] = kToken;
  sendJson(doc);
}

void sendPing() {
  JsonDocument doc;
  doc["type"] = "ping";
  doc["token"] = kToken;
  sendJson(doc);
}

void sendAgentStatus(const char* status, const char* message) {
  JsonDocument doc;
  doc["type"] = "agentStatus";
  doc["token"] = kToken;
  doc["status"] = status;
  doc["source"] = "m5stack";
  doc["message"] = message;
  doc["ttlMs"] = 120000;
  sendJson(doc);
  showToast(String("sent: ") + status);
}

bool discoverService(String& hostOut, uint16_t& portOut) {
  if (strlen(kFallbackHost) > 0) {
    hostOut = kFallbackHost;
    portOut = VIBE_REMOTE_PORT;
    return true;
  }

  if (!mdnsReady) {
    return false;
  }

  const int found = MDNS.queryService(kServiceType, "tcp");
  if (found <= 0) {
    return false;
  }

  IPAddress ip = MDNS.IP(0);
  if (ip != IPAddress(0, 0, 0, 0)) {
    hostOut = ip.toString();
  } else {
    hostOut = MDNS.hostname(0);
  }
  portOut = MDNS.port(0);
  return hostOut.length() > 0 && portOut > 0;
}

void beginWebSocket(const String& host, uint16_t port) {
  ws.disconnect();
  ws.begin(host.c_str(), port, "/");
  ws.setReconnectInterval(kReconnectIntervalMs);
  showToast("connect " + host + ":" + String(port));
}

String buildActivityLine(JsonObject activity) {
  String line;
  const char* command = activity["command"] | "";
  const char* file = activity["file"] | "";
  const int errors = activity["errors"] | 0;
  const int warnings = activity["warnings"] | 0;
  const bool taskRunning = activity["taskRunning"] | false;
  const bool debugging = activity["debugging"] | false;

  if (strlen(command) > 0) {
    line += command;
  } else if (strlen(file) > 0) {
    line += file;
  } else if (taskRunning) {
    line += "task running";
  } else if (debugging) {
    line += "debugging";
  } else {
    line += "quiet";
  }
  line += " E";
  line += errors;
  line += " W";
  line += warnings;
  return line;
}

void applyState(JsonDocument& doc) {
  chatState = doc["chat"] | "idle";

  JsonObject agent = doc["agent"].as<JsonObject>();
  if (!agent.isNull()) {
    agentSource = agent["source"] | "-";
    agentStatus = agent["status"] | "idle";
    agentMessage = agent["message"] | "";
  } else {
    agentSource = "-";
    agentStatus = "idle";
    agentMessage = "";
  }

  JsonObject activity = doc["activity"].as<JsonObject>();
  activityLine = activity.isNull() ? "" : buildActivityLine(activity);
  markDirty();
}

void handleInboundJson(const uint8_t* payload, size_t length) {
  JsonDocument doc;
  const DeserializationError err = deserializeJson(doc, payload, length);
  if (err) {
    lastError = "JSON parse error";
    showToast(lastError);
    return;
  }

  const char* msgType = doc["type"] | "";
  if (strcmp(msgType, "ack") == 0) {
    const bool ok = doc["ok"] | false;
    const char* error = doc["error"] | "";
    if (!ok && strlen(error) > 0) {
      lastError = error;
    }
    showToast(String("ack: ") + (ok ? "OK" : "NG"));
    return;
  }

  if (strcmp(msgType, "state") == 0) {
    applyState(doc);
    return;
  }

  showToast(String("msg: ") + msgType);
}

void onWsEvent(WStype_t type, uint8_t* payload, size_t length) {
  switch (type) {
    case WStype_CONNECTED:
      wsConnected = true;
      lastError = "";
      showToast("WS connected");
      sendHello();
      break;

    case WStype_DISCONNECTED:
      wsConnected = false;
      showToast("WS disconnected");
      break;

    case WStype_TEXT: {
      handleInboundJson(payload, length);
      break;
    }

    default:
      break;
  }
}

void connectWifi() {
  if (strlen(kWifiSsid) == 0 || strlen(kWifiPass) == 0) {
    lastError = "WiFi credentials missing";
    showToast("set WiFi build_flags");
    return;
  }

  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(kWifiSsid, kWifiPass);

  showToast("WiFi connecting...");
  const unsigned long startedAt = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - startedAt < kWifiTimeoutMs) {
    delay(250);
#if HAS_M5UNIFIED
    M5.update();
#endif
  }

  wifiReady = WiFi.status() == WL_CONNECTED;
  if (wifiReady) {
    showToast("WiFi " + WiFi.localIP().toString());
  } else {
    lastError = "WiFi timeout";
    showToast(lastError);
  }
}

void setupSpp() {
#if VIBE_TRANSPORT_SPP
  if (!SerialBT.begin(kDeviceName)) {
    lastError = "SPP start failed";
    showToast(lastError);
    return;
  }
  showToast(String("SPP advertising: ") + kDeviceName);
#endif
}

void setupDisplay() {
#if HAS_M5UNIFIED
  auto cfg = M5.config();
  M5.begin(cfg);
  M5.Display.setRotation(1);
  M5.Display.setBrightness(160);
  M5.Display.fillScreen(TFT_BLACK);
  M5.Display.setTextSize(1);
#endif
}

void setupMdns() {
  if (!wifiReady) {
    return;
  }

  String host = String("m5-vibe-") + String((uint32_t)ESP.getEfuseMac(), HEX);
  host.toLowerCase();
  mdnsReady = MDNS.begin(host.c_str());
  showToast(mdnsReady ? "mDNS " + host + ".local" : "mDNS failed");
}

void ensureConnection() {
#if VIBE_TRANSPORT_SPP
  const bool connectedNow = SerialBT.hasClient();
  if (connectedNow && !sppConnected) {
    sppConnected = true;
    lastError = "";
    showToast("SPP connected");
    sendHello();
  } else if (!connectedNow && sppConnected) {
    sppConnected = false;
    showToast("SPP disconnected");
  }
  return;
#else
  if (WiFi.status() != WL_CONNECTED) {
    if (wifiReady) {
      wifiReady = false;
      wsConnected = false;
      remoteHost = "";
      showToast("WiFi lost");
    }
    return;
  }

  if (!wifiReady) {
    wifiReady = true;
    setupMdns();
  }

  if (wsConnected) {
    return;
  }

  const unsigned long now = millis();
  if (now - lastReconnectAttempt < kReconnectIntervalMs) {
    return;
  }
  lastReconnectAttempt = now;

  if (remoteHost.length() == 0 || now - lastDiscoverAt > kDiscoverIntervalMs) {
    lastDiscoverAt = now;
    String discoveredHost;
    uint16_t discoveredPort = 0;
    if (discoverService(discoveredHost, discoveredPort)) {
      remoteHost = discoveredHost;
      remotePort = discoveredPort;
      showToast("found " + remoteHost + ":" + String(remotePort));
    } else {
      showToast("hub not found");
      return;
    }
  }

  beginWebSocket(remoteHost, remotePort);
#endif
}

void reconnectNow() {
#if VIBE_TRANSPORT_SPP
  SerialBT.disconnect();
  sppConnected = false;
  sppRxBuffer = "";
  showToast("SPP reconnect requested");
#else
  ws.disconnect();
  wsConnected = false;
  remoteHost = "";
  lastDiscoverAt = 0;
  lastReconnectAttempt = 0;
  showToast("reconnect requested");
#endif
}

void pollSppInput() {
#if VIBE_TRANSPORT_SPP
  while (SerialBT.available() > 0) {
    const int next = SerialBT.read();
    if (next < 0) {
      return;
    }
    if (next == '\r') {
      continue;
    }
    if (next == '\n') {
      const String line = sppRxBuffer;
      sppRxBuffer = "";
      if (line.length() > 0) {
        handleInboundJson(reinterpret_cast<const uint8_t*>(line.c_str()), line.length());
      }
      continue;
    }
    sppRxBuffer += static_cast<char>(next);
    if (sppRxBuffer.length() > 8192) {
      sppRxBuffer = "";
      lastError = "SPP buffer overflow";
      showToast(lastError);
    }
  }
#endif
}

void handleButtons() {
#if HAS_M5UNIFIED
  M5.update();
  if (M5.BtnA.wasHold()) {
    sendAgentStatus("failed", "button A hold");
  } else if (M5.BtnA.wasClicked()) {
    sendAgentStatus("running", "button A");
  }

  if (M5.BtnB.wasHold()) {
    sendAgentStatus("idle", "button B hold");
  } else if (M5.BtnB.wasClicked()) {
    sendAgentStatus("waiting", "button B");
  }

  if (M5.BtnC.wasHold()) {
    reconnectNow();
  } else if (M5.BtnC.wasClicked()) {
    sendAgentStatus("done", "button C");
  }
#endif
}

void refreshUi() {
  const unsigned long now = millis();
  if (!displayDirty && now - lastUiRefreshAt < kUiRefreshIntervalMs) {
    return;
  }
  lastUiRefreshAt = now;
  displayDirty = false;
  drawDashboard();
}
}  // namespace

void setup() {
  Serial.begin(115200);
  delay(200);

  setupDisplay();
  tokenReady = strlen(kToken) > 0;
  if (!tokenReady) {
    lastError = "token missing";
  }

  showToast("Vibe Remote starting");
#if VIBE_TRANSPORT_SPP
  setupSpp();
#else
  connectWifi();
  setupMdns();

  ws.onEvent(onWsEvent);
#endif
  markDirty();
}

void loop() {
#if VIBE_TRANSPORT_SPP
  pollSppInput();
#else
  ws.loop();
#endif
  ensureConnection();
  handleButtons();

  const unsigned long now = millis();
#if VIBE_TRANSPORT_SPP
  if (sppConnected && tokenReady && now - lastPingAt >= kPingIntervalMs) {
    sendPing();
    lastPingAt = now;
  }
#else
  if (wsConnected && tokenReady && now - lastPingAt >= kPingIntervalMs) {
    sendPing();
    lastPingAt = now;
  }
#endif

  refreshUi();
  delay(10);
}
