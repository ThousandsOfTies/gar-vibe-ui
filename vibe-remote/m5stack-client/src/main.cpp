#include <Arduino.h>
#include <WiFi.h>
#include <ESPmDNS.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>

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

namespace {
constexpr uint16_t kDefaultPort = 39271;
constexpr uint32_t kReconnectIntervalMs = 3000;
constexpr uint32_t kPingIntervalMs = 5000;
constexpr uint32_t kDiscoverIntervalMs = 10000;

const char* kWifiSsid = VIBE_WIFI_SSID;
const char* kWifiPass = VIBE_WIFI_PASS;
const char* kToken = VIBE_REMOTE_TOKEN;
const char* kServiceType = VIBE_SERVICE_TYPE;

WebSocketsClient ws;
String remoteHost;
uint16_t remotePort = kDefaultPort;
unsigned long lastReconnectAttempt = 0;
unsigned long lastPingAt = 0;
unsigned long lastDiscoverAt = 0;
bool wsConnected = false;

void uiPrint(const String& line) {
  Serial.println(line);
#if HAS_M5UNIFIED
  static int y = 10;
  M5.Display.setTextColor(TFT_WHITE, TFT_BLACK);
  M5.Display.setCursor(8, y);
  M5.Display.print("                    ");
  M5.Display.setCursor(8, y);
  M5.Display.println(line);
  y += 16;
  if (y > 220) {
    y = 10;
    M5.Display.fillScreen(TFT_BLACK);
  }
#endif
}

void sendHello() {
  StaticJsonDocument<128> doc;
  doc["type"] = "hello";
  doc["token"] = kToken;

  String payload;
  serializeJson(doc, payload);
  ws.sendTXT(payload);
}

void sendPing() {
  StaticJsonDocument<128> doc;
  doc["type"] = "ping";
  doc["token"] = kToken;

  String payload;
  serializeJson(doc, payload);
  ws.sendTXT(payload);
}

void sendAgentStatus(const char* status, const char* message) {
  StaticJsonDocument<256> doc;
  doc["type"] = "agentStatus";
  doc["token"] = kToken;
  doc["status"] = status;
  doc["source"] = "m5stack";
  doc["message"] = message;

  String payload;
  serializeJson(doc, payload);
  ws.sendTXT(payload);
}

bool discoverService(String& hostOut, uint16_t& portOut) {
  const int found = MDNS.queryService(kServiceType, "tcp");
  if (found <= 0) {
    return false;
  }

  hostOut = MDNS.hostname(0);
  portOut = MDNS.port(0);
  return hostOut.length() > 0 && portOut > 0;
}

void beginWebSocket(const String& host, uint16_t port) {
  ws.disconnect();
  ws.begin(host.c_str(), port, "/");
  ws.setReconnectInterval(kReconnectIntervalMs);
  uiPrint("WS connect: " + host + ":" + String(port));
}

void onWsEvent(WStype_t type, uint8_t* payload, size_t length) {
  switch (type) {
    case WStype_CONNECTED:
      wsConnected = true;
      uiPrint("WS connected");
      sendHello();
      break;

    case WStype_DISCONNECTED:
      wsConnected = false;
      uiPrint("WS disconnected");
      break;

    case WStype_TEXT: {
      JsonDocument doc;
      const auto err = deserializeJson(doc, payload, length);
      if (err) {
        uiPrint("JSON parse error");
        return;
      }

      const char* msgType = doc["type"] | "";
      if (strcmp(msgType, "ack") == 0) {
        bool ok = doc["ok"] | false;
        uiPrint(String("ack: ") + (ok ? "OK" : "NG"));
        return;
      }

      if (strcmp(msgType, "state") == 0) {
        const char* chat = doc["chat"] | "?";
        const char* agentStatus = doc["agent"]["status"] | "none";
        uiPrint(String("state chat=") + chat + " agent=" + agentStatus);
        return;
      }

      uiPrint(String("msg type=") + msgType);
      break;
    }

    default:
      break;
  }
}

void connectWifi() {
  if (strlen(kWifiSsid) == 0 || strlen(kWifiPass) == 0) {
    uiPrint("Set WiFi creds in build_flags");
    return;
  }

  WiFi.mode(WIFI_STA);
  WiFi.begin(kWifiSsid, kWifiPass);

  uiPrint("Connecting WiFi...");
  while (WiFi.status() != WL_CONNECTED) {
    delay(400);
    Serial.print('.');
  }
  Serial.println();

  uiPrint(String("WiFi OK: ") + WiFi.localIP().toString());
}

void setupDisplay() {
#if HAS_M5UNIFIED
  auto cfg = M5.config();
  M5.begin(cfg);
  M5.Display.setRotation(1);
  M5.Display.fillScreen(TFT_BLACK);
  M5.Display.setTextSize(2);
#else
  (void)0;
#endif
}

void setupMdns() {
  String host = String("m5-vibe-") + String((uint32_t)ESP.getEfuseMac(), HEX);
  host.toLowerCase();
  if (MDNS.begin(host.c_str())) {
    uiPrint("mDNS ready: " + host + ".local");
  } else {
    uiPrint("mDNS start failed");
  }
}

void ensureConnection() {
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
      uiPrint("Discovered: " + remoteHost + ":" + String(remotePort));
    } else {
      uiPrint("mDNS service not found");
      return;
    }
  }

  beginWebSocket(remoteHost, remotePort);
}

void handleButtons() {
#if HAS_M5UNIFIED
  M5.update();
  if (M5.BtnA.wasClicked()) {
    sendAgentStatus("running", "button A");
  }
  if (M5.BtnB.wasClicked()) {
    sendAgentStatus("waiting", "button B");
  }
  if (M5.BtnC.wasClicked()) {
    sendAgentStatus("done", "button C");
  }
#endif
}
}  // namespace

void setup() {
  Serial.begin(115200);
  delay(200);

  setupDisplay();
  uiPrint("Vibe Remote draft client");

  if (strlen(kToken) == 0) {
    uiPrint("Set VIBE_REMOTE_TOKEN");
  }

  connectWifi();
  setupMdns();

  ws.onEvent(onWsEvent);
}

void loop() {
  ws.loop();
  ensureConnection();
  handleButtons();

  const unsigned long now = millis();
  if (wsConnected && now - lastPingAt >= kPingIntervalMs) {
    sendPing();
    lastPingAt = now;
  }

  delay(10);
}
