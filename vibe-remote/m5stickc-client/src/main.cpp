#include <Arduino.h>
#include <ArduinoJson.h>
#include <ESPmDNS.h>
#include <WebSocketsClient.h>
#include <WiFi.h>

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

#ifndef VIBE_REMOTE_HOST
#define VIBE_REMOTE_HOST ""
#endif

#ifndef VIBE_REMOTE_PORT
#define VIBE_REMOTE_PORT 39271
#endif

#ifndef VIBE_SERVICE_TYPE
#define VIBE_SERVICE_TYPE "vibe-remote"
#endif

#ifndef VIBE_DEVICE_NAME
#define VIBE_DEVICE_NAME "M5StickC Plus2 Vibe"
#endif

namespace {
constexpr uint32_t kWifiTimeoutMs = 20000;
constexpr uint32_t kPingIntervalMs = 5000;
constexpr uint32_t kReconnectIntervalMs = 3000;
constexpr uint32_t kDiscoverIntervalMs = 10000;
constexpr uint32_t kWifiRetryIntervalMs = 10000;
constexpr uint32_t kUiIntervalMs = 500;
constexpr uint32_t kButtonHitLatchMs = 1200;
constexpr uint32_t kButtonHoldMs = 900;
constexpr int kMaxDeviceUiActions = 6;
#if defined(VIBE_WOKWI)
constexpr uint8_t kButtonAGpio = 32;
constexpr uint8_t kButtonBGpio = 33;
constexpr uint8_t kButtonPwrGpio = 27;
#else
constexpr uint8_t kButtonAGpio = 37;
constexpr uint8_t kButtonBGpio = 39;
constexpr uint8_t kButtonPwrGpio = 35;
#endif

const char* kSsid = VIBE_WIFI_SSID;
const char* kPass = VIBE_WIFI_PASS;
const char* kToken = VIBE_REMOTE_TOKEN;
const char* kFallbackHost = VIBE_REMOTE_HOST;
const char* kServiceType = VIBE_SERVICE_TYPE;
const char* kDeviceName = VIBE_DEVICE_NAME;
constexpr uint16_t kFallbackPort = VIBE_REMOTE_PORT;

WebSocketsClient ws;

bool wifiReady = false;
bool wsReady = false;
bool mdnsReady = false;
bool displayDirty = true;
bool uiFrameDrawn = false;
unsigned long lastPingAt = 0;
unsigned long lastReconnectAttempt = 0;
unsigned long lastDiscoverAt = 0;
unsigned long lastWifiAttempt = 0;
unsigned long lastUiAt = 0;

String remoteHost;
uint16_t remotePort = kFallbackPort;
bool wsStarted = false;
String wsStartedHost;
uint16_t wsStartedPort = 0;
String wsPhase = "off";
String chatState = "idle";
String agentSource = "-";
String agentStatus = "idle";
String agentMessage = "";
bool deviceUiActive = false;
String deviceUiId;
String deviceUiTitle;
String deviceUiState = "waiting";
String deviceUiMode = "menu";
String deviceUiMessage;
String deviceUiFieldLabels[3];
String deviceUiFieldValues[3];
int deviceUiFieldCount = 0;
String deviceUiActionIds[kMaxDeviceUiActions];
String deviceUiActionLabels[kMaxDeviceUiActions];
String deviceUiActionButtons[kMaxDeviceUiActions];
int deviceUiActionCount = 0;
int deviceUiSelected = 0;
String pendingUiId;
String pendingActionLabel;
unsigned long pendingActionUntil = 0;
String lastLine = "boot";
String lastSentStatus = "-";
String serialRx;
bool lastDirectA = false;
bool lastDirectB = false;
bool lastDirectPwr = false;
bool currentDirectA = false;
bool currentDirectB = false;
bool currentDirectPwr = false;
unsigned long buttonAPressedAt = 0;
unsigned long buttonBPressedAt = 0;
unsigned long buttonPwrPressedAt = 0;
bool buttonAHoldSent = false;
bool buttonBHoldSent = false;
bool buttonPwrHoldSent = false;
String buttonHit = "-";
unsigned long buttonHitUntil = 0;
bool lastDrawnWifiReady = false;
bool lastDrawnWsReady = false;
String lastDrawnWsPhase;
int lastDrawnBatteryPercent = -1;
String lastDrawnIp;
String lastDrawnHub;
String lastDrawnChat;
String lastDrawnAgentSource;
String lastDrawnAgentStatus;
String lastDrawnAgentMessage;
String lastDrawnDeviceUiDetails;
String lastDrawnHit;
String lastDrawnFooter;

// Theme palette (mirrors the VS Code Vibe Remote status viewer's dark theme
// so the physical device and the webview share one visual language).
// Falls back to plain TFT_* constants until initTheme() runs in setup().
uint16_t colorBg = TFT_BLACK;
uint16_t colorPanel = TFT_DARKGREY;
uint16_t colorLine = TFT_DARKGREY;
uint16_t colorText = TFT_WHITE;
uint16_t colorMuted = TFT_LIGHTGREY;
uint16_t colorAccent = TFT_CYAN;
uint16_t colorGreen = TFT_GREEN;
uint16_t colorYellow = TFT_YELLOW;
uint16_t colorRed = TFT_RED;

constexpr int kCardX = 7;
constexpr int kCardInsetX = 8;
constexpr int kStatusY = 31;
constexpr int kStatusH = 66;
constexpr int kDetailY = 105;
constexpr int kDetailH = 48;
constexpr int kToastY = 158;

void initTheme() {
#if HAS_M5UNIFIED
  colorBg = M5.Display.color565(14, 17, 22);
  colorPanel = M5.Display.color565(22, 27, 34);
  colorLine = M5.Display.color565(42, 51, 64);
  colorText = M5.Display.color565(230, 237, 243);
  colorMuted = M5.Display.color565(154, 167, 180);
  colorAccent = M5.Display.color565(88, 166, 255);
  colorGreen = M5.Display.color565(63, 185, 80);
  colorYellow = M5.Display.color565(227, 179, 65);
  colorRed = M5.Display.color565(248, 81, 73);
#endif
}

void mark(const String& line) {
  lastLine = line;
  displayDirty = true;
  Serial.println(line);
}

void markIfChanged(const String& line) {
  if (lastLine == line) {
    return;
  }
  mark(line);
}

void latchButtonHit(const char* label) {
  buttonHit = label;
  buttonHitUntil = millis() + kButtonHitLatchMs;
  displayDirty = true;
}

void latchPendingAction(const String& uiId, const String& label) {
  pendingUiId = uiId;
  pendingActionLabel = label;
  pendingActionUntil = millis() + 5000;
  displayDirty = true;
}

void clearPendingAction() {
  pendingUiId = "";
  pendingActionLabel = "";
  pendingActionUntil = 0;
  displayDirty = true;
}

uint16_t statusColor(const String& status) {
  if (status == "running") {
    return colorGreen;
  }
  if (status == "waiting") {
    return colorYellow;
  }
  if (status == "failed") {
    return colorRed;
  }
  if (status == "done") {
    return colorAccent;
  }
  return colorMuted;
}

uint16_t connectionColor(bool ok) {
  return ok ? colorGreen : colorRed;
}

uint16_t wsPhaseColor() {
  if (wsReady || wsPhase == "online") {
    return colorGreen;
  }
  if (wsPhase == "conn" || wsPhase == "reconn" || wsPhase == "search") {
    return colorYellow;
  }
  return colorRed;
}

uint16_t batteryColor(int percent) {
  if (percent <= 20) {
    return colorRed;
  }
  if (percent <= 45) {
    return colorYellow;
  }
  return colorGreen;
}

String upperStatus(const String& status) {
  String value = status;
  value.toUpperCase();
  return value;
}

String gpioMessage(uint8_t gpio, const char* label) {
  return String("gpio") + String(gpio) + " " + label;
}

void drawChipColor(int x, int y, const char* label, uint16_t color) {
  const int width = 38;
  const int height = 15;
  M5.Display.fillRoundRect(x - 1, y - 1, width + 2, height + 2, 4, colorPanel);
  M5.Display.drawRoundRect(x, y, width, height, 4, color);
  M5.Display.fillCircle(x + 8, y + 7, 3, color);
  M5.Display.setTextColor(colorText, colorPanel);
  M5.Display.drawString(label, x + 15, y + 4);
}

void drawChip(int x, int y, const char* label, bool ok) {
  drawChipColor(x, y, label, connectionColor(ok));
}

int batteryPercent() {
  int percent = M5.Power.getBatteryLevel();
  if (percent < 0) {
    percent = 0;
  }
  if (percent > 100) {
    percent = 100;
  }
  return percent;
}

void drawBattery(int x, int y, int percent) {
  const int bodyW = 20;
  const int bodyH = 12;
  const uint16_t color = batteryColor(percent);
  M5.Display.fillRect(x - 2, y - 1, bodyW + 13, bodyH + 4, colorPanel);
  M5.Display.drawRect(x, y, bodyW, bodyH, colorMuted);
  M5.Display.fillRect(x + bodyW, y + 4, 2, 4, colorMuted);
  M5.Display.fillRect(x + 2, y + 2, bodyW - 4, bodyH - 4, colorBg);
  const int fillW = ((bodyW - 4) * percent) / 100;
  if (fillW > 0) {
    M5.Display.fillRect(x + 2, y + 2, fillW, bodyH - 4, color);
  }
  M5.Display.setTextSize(1);
  M5.Display.setTextColor(colorMuted, colorPanel);
  M5.Display.drawString(String(percent), x + bodyW + 5, y + 2);
}

void drawStaticFrame() {
  const int width = M5.Display.width();
  const int height = M5.Display.height();
  M5.Display.fillScreen(colorBg);
  M5.Display.fillRect(0, 0, width, 23, colorPanel);
  M5.Display.drawFastHLine(0, 23, width, colorLine);
  M5.Display.fillRect(0, height - 33, width, 33, colorPanel);
  M5.Display.drawFastHLine(0, height - 33, width, colorLine);
  uiFrameDrawn = true;
}

void clearArea(int x, int y, int w, int h) {
  M5.Display.fillRect(x, y, w, h, colorBg);
}

void clearCardArea(int x, int y, int w, int h) {
  clearArea(x - 1, y - 1, w + 2, h + 2);
}

void drawWrappedText(const String& text, int x, int y, int charsPerLine, int maxLines, uint16_t fg, uint16_t bg) {
  M5.Display.setTextColor(fg, bg);
  M5.Display.setTextSize(1);
  String remaining = text;
  remaining.trim();
  for (int line = 0; line < maxLines; ++line) {
    if (remaining.length() == 0) {
      return;
    }
    String chunk = remaining.substring(0, charsPerLine);
    int breakAt = chunk.lastIndexOf(' ');
    if (remaining.length() > charsPerLine && breakAt > 5) {
      chunk = chunk.substring(0, breakAt);
    }
    M5.Display.drawString(chunk, x, y + line * 13);
    remaining = remaining.substring(chunk.length());
    remaining.trim();
  }
}

void drawStatusCard(int width, const String& status, const String& chat, const String& source, uint16_t stateColor) {
  const int cardW = width - (kCardX * 2);
  const int textX = kCardX + 11;
  clearCardArea(kCardX, kStatusY, cardW, kStatusH);
  M5.Display.fillRoundRect(kCardX, kStatusY, cardW, kStatusH, 6, colorPanel);
  M5.Display.drawRoundRect(kCardX, kStatusY, cardW, kStatusH, 6, stateColor);
  M5.Display.fillRect(kCardX + 2, kStatusY + 2, 4, kStatusH - 4, stateColor);
  if (source == "device-ui") {
    M5.Display.setTextSize(1);
    M5.Display.setTextColor(stateColor, colorPanel);
    M5.Display.drawString(upperStatus(status).substring(0, 12), textX, kStatusY + 8);
    M5.Display.setTextSize(2);
    M5.Display.setTextColor(colorText, colorPanel);
    M5.Display.drawString(chat.substring(0, 9), textX, kStatusY + 26);
    return;
  }

  M5.Display.setTextSize(2);
  M5.Display.setTextColor(stateColor, colorPanel);
  M5.Display.drawString(upperStatus(status).substring(0, 8), textX, kStatusY + 14);
  M5.Display.setTextSize(1);
  M5.Display.setTextColor(colorMuted, colorPanel);
  M5.Display.drawString(String("chat  ") + chat.substring(0, 12), textX, kStatusY + 41);
  M5.Display.drawString(String("agent ") + source.substring(0, 12), textX, kStatusY + 53);
}

void drawInfoRows(int width, const String& ipText, const String& hubText, const String& message) {
  const int cardW = width - (kCardX * 2);
  const int labelX = kCardX + kCardInsetX;
  const int valueX = kCardX + 32;
  const int rowY = kDetailY + 8;
  clearCardArea(kCardX, kDetailY, cardW, kDetailH);
  M5.Display.fillRoundRect(kCardX, kDetailY, cardW, kDetailH, 4, colorPanel);
  M5.Display.drawRoundRect(kCardX, kDetailY, cardW, kDetailH, 4, colorLine);
  M5.Display.setTextColor(colorMuted, colorPanel);
  M5.Display.drawString("IP", labelX, rowY);
  M5.Display.setTextColor(colorText, colorPanel);
  M5.Display.drawString(ipText.substring(0, 16), valueX, rowY);
  M5.Display.setTextColor(colorMuted, colorPanel);
  M5.Display.drawString("Hub", labelX, rowY + 13);
  M5.Display.setTextColor(colorText, colorPanel);
  M5.Display.drawString(hubText.substring(0, 15), valueX, rowY + 13);
  M5.Display.setTextColor(colorMuted, colorPanel);
  M5.Display.drawString("Msg", labelX, rowY + 26);
  M5.Display.setTextColor(colorText, colorPanel);
  M5.Display.drawString(message.substring(0, 15), valueX, rowY + 26);
}

void drawDeviceUiDetails(int width) {
  const int cardW = width - (kCardX * 2);
  const int textX = kCardX + kCardInsetX;
  const int valueX = kCardX + 50;
  const int rowY = kDetailY + 8;
  clearCardArea(kCardX, kDetailY, cardW, kDetailH);
  if (pendingUiId == deviceUiId && millis() < pendingActionUntil && pendingActionLabel.length() > 0) {
    M5.Display.fillRoundRect(kCardX, kDetailY, cardW, kDetailH, 5, colorPanel);
    M5.Display.drawRoundRect(kCardX, kDetailY, cardW, kDetailH, 5, colorAccent);
    M5.Display.setTextColor(colorAccent, colorPanel);
    M5.Display.drawString("SENT", textX, rowY);
    M5.Display.setTextColor(colorText, colorPanel);
    M5.Display.drawString(pendingActionLabel.substring(0, 16), textX, rowY + 18);
    return;
  }

  M5.Display.fillRoundRect(kCardX, kDetailY, cardW, kDetailH, 4, colorPanel);
  M5.Display.drawRoundRect(kCardX, kDetailY, cardW, kDetailH, 4, colorLine);

  if (deviceUiMode == "menu" && deviceUiActionCount > 0) {
    M5.Display.setTextSize(1);
    int row = 0;
    if (deviceUiMessage.length() > 0) {
      M5.Display.setTextColor(colorText, colorPanel);
      M5.Display.drawString(deviceUiMessage.substring(0, 16), textX, rowY);
      row = 1;
    }
    int start = 0;
    if (deviceUiActionCount > 3) {
      start = deviceUiSelected <= 1 ? 0 : deviceUiSelected - 1;
      if (start > deviceUiActionCount - 3) {
        start = deviceUiActionCount - 3;
      }
    }
    for (int index = start; index < deviceUiActionCount && row < 4; ++index, ++row) {
      const bool selected = index == deviceUiSelected;
      M5.Display.setTextColor(selected ? colorYellow : colorMuted, colorPanel);
      M5.Display.drawString(
        String(selected ? "> " : "  ") + deviceUiActionLabels[index].substring(0, 12),
        textX,
        rowY + row * 13
      );
    }
    return;
  }

  if (deviceUiFieldCount == 0 && deviceUiMessage.length() > 0) {
    drawWrappedText(deviceUiMessage, textX, rowY, 16, 3, colorText, colorPanel);
    return;
  }

  M5.Display.setTextSize(1);
  int row = 0;
  if (deviceUiMessage.length() > 0) {
    M5.Display.setTextColor(colorText, colorPanel);
    M5.Display.drawString(deviceUiMessage.substring(0, 16), textX, rowY);
    row = 1;
  }
  for (int index = 0; index < deviceUiFieldCount && row < 3; ++index, ++row) {
    M5.Display.setTextColor(colorMuted, colorPanel);
    M5.Display.drawString(deviceUiFieldLabels[index].substring(0, 6), textX, rowY + row * 13);
    M5.Display.setTextColor(colorText, colorPanel);
    M5.Display.drawString(deviceUiFieldValues[index].substring(0, 12), valueX, rowY + row * 13);
  }
  if (row > 0) {
    return;
  }

  M5.Display.setTextColor(colorMuted, colorPanel);
  for (int index = 0; index < deviceUiActionCount && index < 3; ++index) {
    M5.Display.drawString(
      deviceUiActionButtons[index].substring(0, 1) + String(" ") + deviceUiActionLabels[index].substring(0, 13),
      textX,
      rowY + index * 13
    );
  }
}

String deviceUiDetailsSignature() {
  if (!deviceUiActive) {
    return "";
  }
  if (pendingUiId == deviceUiId && millis() < pendingActionUntil && pendingActionLabel.length() > 0) {
    return String("pending|") + pendingActionLabel;
  }
  String signature = deviceUiMessage;
  for (int index = 0; index < deviceUiFieldCount; ++index) {
    signature += "|";
    signature += deviceUiFieldLabels[index];
    signature += "=";
    signature += deviceUiFieldValues[index];
  }
  for (int index = 0; index < deviceUiActionCount; ++index) {
    signature += "|";
    signature += deviceUiActionButtons[index];
    signature += ":";
    signature += deviceUiActionLabels[index];
  }
  signature += "|mode=";
  signature += deviceUiMode;
  signature += "|sel=";
  signature += String(deviceUiSelected);
  return signature;
}

void drawToast(int width, const String& hit) {
  const int cardW = width - (kCardX * 2);
  clearCardArea(kCardX, kToastY, cardW, 25);
  if (hit.length() > 0) {
    M5.Display.fillRoundRect(kCardX, kToastY, cardW, 23, 5, colorPanel);
    M5.Display.drawRoundRect(kCardX, kToastY, cardW, 23, 5, colorAccent);
    M5.Display.setTextColor(colorText, colorPanel);
    M5.Display.drawString(String("button ") + hit.substring(0, 10), kCardX + kCardInsetX, kToastY + 8);
  }
}

String actionLabelForButton(const String& button) {
  if (!deviceUiActive) {
    return "";
  }
  for (int index = 0; index < deviceUiActionCount; ++index) {
    if (deviceUiActionButtons[index] == button) {
      return deviceUiActionLabels[index];
    }
  }
  return "";
}

String footerLine(const char* prefix, const String& button, const char* fallback) {
  if (deviceUiActive && deviceUiMode == "menu") {
    if (button == "A") {
      return String(prefix) + "Select";
    }
    if (button == "B") {
      return String(prefix) + "Next";
    }
    if (button == "P") {
      return String(prefix) + "Back";
    }
  }
  String label = actionLabelForButton(button);
  if (label.length() == 0) {
    return String(prefix) + fallback;
  }
  return String(prefix) + label;
}

void drawFooter(int width) {
  const int height = M5.Display.height();
  const String footer =
    footerLine("A ", "A", "Run / hold Fail") + "\n" +
    footerLine("B ", "B", "Wait / hold Idle") + "\n" +
    footerLine("P ", "P", "Done / hold Reconn");
  if (footer == lastDrawnFooter) {
    return;
  }
  M5.Display.fillRect(0, height - 33, width, 33, colorPanel);
  M5.Display.drawFastHLine(0, height - 33, width, colorLine);
  M5.Display.setTextColor(colorText, colorPanel);
  M5.Display.setTextSize(1);
  int lineStart = 0;
  int y = height - 30;
  while (lineStart < footer.length() && y <= height - 7) {
    int lineEnd = footer.indexOf('\n', lineStart);
    if (lineEnd < 0) {
      lineEnd = footer.length();
    }
    M5.Display.drawString(footer.substring(lineStart, lineEnd).substring(0, 19), 10, y);
    lineStart = lineEnd + 1;
    y += 10;
  }
  lastDrawnFooter = footer;
}

void drawUi() {
#if HAS_M5UNIFIED
  const int width = M5.Display.width();
  const String displayStatus = deviceUiActive ? deviceUiState : agentStatus;
  const String displayChat = deviceUiActive ? deviceUiTitle : chatState;
  const String displaySource = deviceUiActive ? "device-ui" : agentSource;
  const String displayMessage = deviceUiActive ? deviceUiMessage : agentMessage;
  const uint16_t stateColor = statusColor(displayStatus);
  const String hit = millis() < buttonHitUntil ? buttonHit : "";
  const String ipText = wifiReady ? WiFi.localIP().toString() : String("down(") + String(WiFi.status()) + ")";
  const String hubText = wsReady
    ? remoteHost + ":" + String(remotePort)
    : (remoteHost.length() ? wsPhase + " " + remoteHost + ":" + String(remotePort) : wsPhase);
  const int batPercent = batteryPercent();

  if (!uiFrameDrawn) {
    drawStaticFrame();
    lastDrawnWifiReady = !wifiReady;
    lastDrawnWsReady = !wsReady;
    lastDrawnWsPhase = "";
    lastDrawnBatteryPercent = -1;
    lastDrawnIp = "";
    lastDrawnHub = "";
    lastDrawnChat = "";
    lastDrawnAgentSource = "";
    lastDrawnAgentStatus = "";
    lastDrawnAgentMessage = "";
    lastDrawnDeviceUiDetails = "";
    lastDrawnHit = "";
    lastDrawnFooter = "";
  }

  if (wifiReady != lastDrawnWifiReady) {
    drawChip(7, 4, "WiFi", wifiReady);
    lastDrawnWifiReady = wifiReady;
  }
  if (wsReady != lastDrawnWsReady || wsPhase != lastDrawnWsPhase) {
    drawChipColor(width - 45, 4, "WS", wsPhaseColor());
    lastDrawnWsReady = wsReady;
    lastDrawnWsPhase = wsPhase;
  }
  if (batPercent != lastDrawnBatteryPercent) {
    drawBattery(51, 5, batPercent);
    lastDrawnBatteryPercent = batPercent;
  }
  const bool detailDirty =
    ipText != lastDrawnIp ||
    hubText != lastDrawnHub ||
    displayMessage != lastDrawnAgentMessage ||
    displaySource != lastDrawnAgentSource ||
    (deviceUiActive && deviceUiDetailsSignature() != lastDrawnDeviceUiDetails);
  if (displayStatus != lastDrawnAgentStatus || displayChat != lastDrawnChat || displaySource != lastDrawnAgentSource) {
    drawStatusCard(width, displayStatus, displayChat, displaySource, stateColor);
    lastDrawnAgentStatus = displayStatus;
    lastDrawnChat = displayChat;
    lastDrawnAgentSource = displaySource;
  }
  if (detailDirty) {
    if (deviceUiActive) {
      drawDeviceUiDetails(width);
    } else {
      drawInfoRows(width, ipText, hubText, displayMessage);
    }
    lastDrawnIp = ipText;
    lastDrawnHub = hubText;
    lastDrawnAgentMessage = displayMessage;
    lastDrawnDeviceUiDetails = deviceUiActive ? deviceUiDetailsSignature() : "";
  }
  if (hit != lastDrawnHit) {
    drawToast(width, hit);
    lastDrawnHit = hit;
  }
  drawFooter(width);
#endif
}

void refreshUi() {
  const unsigned long now = millis();
  if (!displayDirty && now - lastUiAt < kUiIntervalMs) {
    return;
  }
  lastUiAt = now;
  displayDirty = false;
  drawUi();
}

void sendDoc(JsonDocument& doc) {
  if (!wsReady) {
    mark("drop: ws down");
    return;
  }

  String payload;
  serializeJson(doc, payload);
  ws.sendTXT(payload);
}

void sendHello() {
  JsonDocument doc;
  doc["type"] = "hello";
  doc["token"] = kToken;
  sendDoc(doc);
}

void sendPing() {
  JsonDocument doc;
  doc["type"] = "ping";
  doc["token"] = kToken;
  sendDoc(doc);
}

void sendAgentStatus(const char* status, const char* message) {
  JsonDocument doc;
  doc["type"] = "agentStatus";
  doc["token"] = kToken;
  doc["status"] = status;
  doc["source"] = kDeviceName;
  doc["message"] = message;
  doc["ttlMs"] = 120000;
  sendDoc(doc);
  lastSentStatus = status;
  mark(String("sent: ") + status);
}

bool findActionForButton(const String& button, String& actionIdOut, String& labelOut) {
  if (!deviceUiActive || deviceUiMode == "menu") {
    return false;
  }
  for (int index = 0; index < deviceUiActionCount; ++index) {
    if (deviceUiActionButtons[index] == button) {
      actionIdOut = deviceUiActionIds[index];
      labelOut = deviceUiActionLabels[index];
      return true;
    }
  }
  return false;
}

bool sendUiAction(const String& actionId, const String& label, const String& button) {
  const String uiId = deviceUiId;
  JsonDocument doc;
  doc["type"] = "uiAction";
  doc["token"] = kToken;
  doc["uiId"] = uiId;
  doc["actionId"] = actionId;
  doc["button"] = button;
  doc["source"] = kDeviceName;
  sendDoc(doc);
  latchPendingAction(uiId, label);
  latchButtonHit((String("sent ") + label).c_str());
  mark(String("ui: ") + label);
  return true;
}

bool sendUiActionForButton(const String& button) {
  String actionId;
  String label;
  if (!findActionForButton(button, actionId, label)) {
    return false;
  }
  return sendUiAction(actionId, label, button);
}

bool sendSelectedDeviceUiAction(const String& button) {
  if (!deviceUiActive || deviceUiMode != "menu" || deviceUiActionCount <= 0) {
    return false;
  }
  if (deviceUiSelected < 0 || deviceUiSelected >= deviceUiActionCount) {
    deviceUiSelected = 0;
  }
  return sendUiAction(deviceUiActionIds[deviceUiSelected], deviceUiActionLabels[deviceUiSelected], button);
}

bool sendBackDeviceUiAction(const String& button) {
  if (!deviceUiActive || deviceUiMode != "menu") {
    return false;
  }
  for (int index = 0; index < deviceUiActionCount; ++index) {
    const String id = deviceUiActionIds[index];
    if (id == "back" || id == "cancel" || id == "no" || id == "ng") {
      return sendUiAction(deviceUiActionIds[index], deviceUiActionLabels[index], button);
    }
  }
  return sendUiAction("back", "Back", button);
}

bool selectNextDeviceUiAction() {
  if (!deviceUiActive || deviceUiMode != "menu" || deviceUiActionCount <= 0) {
    return false;
  }
  deviceUiSelected = (deviceUiSelected + 1) % deviceUiActionCount;
  latchButtonHit(deviceUiActionLabels[deviceUiSelected].c_str());
  displayDirty = true;
  return true;
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

  JsonObject ui = doc["ui"].as<JsonObject>();
  if (!ui.isNull()) {
    const String nextUiId = ui["id"] | "";
    const bool newUi = !deviceUiActive || nextUiId != deviceUiId;
    if (newUi) {
      Serial.println(String("ui active: ") + nextUiId);
      clearPendingAction();
    }
    deviceUiActive = true;
    deviceUiId = nextUiId;
    deviceUiTitle = ui["title"] | "UI";
    deviceUiState = ui["state"] | "waiting";
    deviceUiMode = ui["mode"] | "menu";
    if (deviceUiMode != "direct") {
      deviceUiMode = "menu";
    }
    deviceUiMessage = ui["message"] | "";
    deviceUiFieldCount = 0;
    JsonArray fields = ui["fields"].as<JsonArray>();
    for (JsonObject field : fields) {
      if (deviceUiFieldCount >= 3) {
        break;
      }
      String label = field["label"] | "";
      String value = field["value"] | "";
      if (label.length() == 0 && value.length() == 0) {
        continue;
      }
      deviceUiFieldLabels[deviceUiFieldCount] = label;
      deviceUiFieldValues[deviceUiFieldCount] = value;
      ++deviceUiFieldCount;
    }
    deviceUiActionCount = 0;
    JsonArray actions = ui["actions"].as<JsonArray>();
    for (JsonObject action : actions) {
      if (deviceUiActionCount >= kMaxDeviceUiActions) {
        break;
      }
      String id = action["id"] | "";
      String label = action["label"] | "";
      String button = action["button"] | "";
      if (id.length() == 0 || label.length() == 0) {
        continue;
      }
      if (button.length() == 0) {
        button = deviceUiActionCount == 0 ? "A" : deviceUiActionCount == 1 ? "B" : "P";
      }
      deviceUiActionIds[deviceUiActionCount] = id;
      deviceUiActionLabels[deviceUiActionCount] = label;
      deviceUiActionButtons[deviceUiActionCount] = button;
      ++deviceUiActionCount;
    }
    if (newUi) {
      int selected = ui["selected"] | 0;
      deviceUiSelected = selected >= 0 && selected < deviceUiActionCount ? selected : 0;
    } else if (deviceUiActionCount <= 0) {
      deviceUiSelected = 0;
    } else if (deviceUiSelected < 0 || deviceUiSelected >= deviceUiActionCount) {
      deviceUiSelected = 0;
    }
  } else if (deviceUiActive) {
    Serial.println("ui cleared");
    deviceUiActive = false;
    deviceUiId = "";
    deviceUiTitle = "";
    deviceUiState = "waiting";
    deviceUiMode = "menu";
    deviceUiMessage = "";
    deviceUiFieldCount = 0;
    deviceUiActionCount = 0;
    deviceUiSelected = 0;
    clearPendingAction();
  }
  displayDirty = true;
}

void handleJson(const uint8_t* payload, size_t length) {
  JsonDocument doc;
  DeserializationError err = deserializeJson(doc, payload, length);
  if (err) {
    Serial.println(String("json parse error: ") + err.c_str() + " len=" + String(length));
    mark("json parse error");
    return;
  }

  const char* type = doc["type"] | "";
  if (strcmp(type, "ack") == 0) {
    const bool ok = doc["ok"] | false;
    mark(String("ack: ") + (ok ? "ok" : "ng"));
    return;
  }
  if (strcmp(type, "state") == 0) {
    applyState(doc);
    return;
  }
  mark(String("msg: ") + type);
}

void onWsEvent(WStype_t type, uint8_t* payload, size_t length) {
  switch (type) {
    case WStype_CONNECTED:
      wsReady = true;
      wsPhase = "online";
      displayDirty = true;
      mark("ws connected");
      sendHello();
      break;
    case WStype_DISCONNECTED:
      wsReady = false;
      if (wsPhase != "reconn") {
        wsPhase = wifiReady ? "off" : "wifi";
      }
      displayDirty = true;
      mark("ws disconnected");
      break;
    case WStype_TEXT:
      handleJson(payload, length);
      break;
    default:
      break;
  }
}

bool hasRequiredConfig() {
  if (strlen(kSsid) == 0 || strlen(kPass) == 0) {
    markIfChanged("missing wifi config");
    return false;
  }
  if (strlen(kToken) == 0) {
    markIfChanged("missing token");
    return false;
  }
  return true;
}

void connectWifi() {
  lastWifiAttempt = millis();
  wifiReady = false;
  wsReady = false;
  wsPhase = "wifi";
  mdnsReady = false;
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.disconnect(true);
  delay(100);
  WiFi.begin(kSsid, kPass);
  mark("wifi connecting");

  const unsigned long started = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - started < kWifiTimeoutMs) {
    delay(250);
#if HAS_M5UNIFIED
    M5.update();
#endif
  }
  wifiReady = WiFi.status() == WL_CONNECTED;
  mark(wifiReady ? "wifi " + WiFi.localIP().toString() : "wifi timeout");
}

void setupMdns() {
  if (!wifiReady || mdnsReady) {
    return;
  }

  String host = String("m5stickc-vibe-") + String((uint32_t)ESP.getEfuseMac(), HEX);
  host.toLowerCase();
  mdnsReady = MDNS.begin(host.c_str());
  mark(mdnsReady ? "mdns ready" : "mdns failed");
}

bool isSameWifiSubnet(IPAddress ip) {
  if (ip == IPAddress(0, 0, 0, 0)) {
    return false;
  }
  const uint32_t mask = static_cast<uint32_t>(WiFi.subnetMask());
  const uint32_t local = static_cast<uint32_t>(WiFi.localIP());
  const uint32_t candidate = static_cast<uint32_t>(ip);
  return (local & mask) == (candidate & mask);
}

bool discoverBridge(String& hostOut, uint16_t& portOut) {
  if (mdnsReady) {
    const int found = MDNS.queryService(kServiceType, "tcp");
    for (int index = 0; index < found; ++index) {
      IPAddress ip = MDNS.IP(index);
      if (isSameWifiSubnet(ip)) {
        hostOut = ip.toString();
        portOut = MDNS.port(index);
        if (hostOut.length() > 0 && portOut > 0) {
          return true;
        }
      }
    }
    if (strlen(kFallbackHost) > 0) {
      hostOut = kFallbackHost;
      portOut = kFallbackPort;
      return true;
    }
    for (int index = 0; index < found; ++index) {
      String hostname = MDNS.hostname(index);
      uint16_t port = MDNS.port(index);
      if (hostname.length() > 0 && port > 0) {
        hostOut = hostname;
        portOut = port;
        return true;
      }
    }
  }

  if (strlen(kFallbackHost) > 0) {
    hostOut = kFallbackHost;
    portOut = kFallbackPort;
    return true;
  }

  return false;
}

void beginWs() {
  if (!wifiReady || remoteHost.length() == 0) {
    return;
  }
  if (wsStarted && wsStartedHost == remoteHost && wsStartedPort == remotePort) {
    return;
  }
  wsPhase = "conn";
  displayDirty = true;
  ws.begin(remoteHost.c_str(), remotePort, "/");
  ws.setReconnectInterval(kReconnectIntervalMs);
  ws.onEvent(onWsEvent);
  wsStarted = true;
  wsStartedHost = remoteHost;
  wsStartedPort = remotePort;
  mark(String("ws begin ") + remoteHost + ":" + String(remotePort));
}

void reconnect() {
  ws.disconnect();
  wsStarted = false;
  wsStartedHost = "";
  wsStartedPort = 0;
  wsReady = false;
  wsPhase = "reconn";
  remoteHost = "";
  lastReconnectAttempt = 0;
  lastDiscoverAt = 0;
  displayDirty = true;
  mark("reconnect requested");
}

void handleCommand(char command) {
  switch (command) {
    case 'r':
      sendAgentStatus("running", "serial r");
      break;
    case 'w':
      sendAgentStatus("waiting", "serial w");
      break;
    case 'd':
      sendAgentStatus("done", "serial d");
      break;
    case 'f':
      sendAgentStatus("failed", "serial f");
      break;
    case 'i':
      sendAgentStatus("idle", "serial i");
      break;
    case 'p':
      sendPing();
      mark("ping");
      break;
    case 'x':
      reconnect();
      break;
    default:
      Serial.println("commands: r running, w waiting, d done, f failed, i idle, p ping, x reconnect");
      break;
  }
}

void pollSerial() {
  while (Serial.available() > 0) {
    char c = static_cast<char>(Serial.read());
    if (c == '\r') {
      continue;
    }
    if (c == '\n') {
      if (serialRx.length() > 0) {
        handleCommand(serialRx[0]);
        serialRx = "";
      }
      continue;
    }
    serialRx += c;
    if (serialRx.length() > 16) {
      serialRx = "";
    }
  }
}

void pollButtons() {
  const unsigned long now = millis();
  const bool directA = digitalRead(kButtonAGpio) == LOW;
  const bool directB = digitalRead(kButtonBGpio) == LOW;
  const bool directPwr = digitalRead(kButtonPwrGpio) == LOW;
  if (directA != currentDirectA || directB != currentDirectB || directPwr != currentDirectPwr) {
    currentDirectA = directA;
    currentDirectB = directB;
    currentDirectPwr = directPwr;
    mark(String("btn: A") + (directA ? "1" : "0") +
         " B" + (directB ? "1" : "0") +
         " P" + (directPwr ? "1" : "0"));
  }
  if (directA && !lastDirectA) {
    buttonAPressedAt = now;
    buttonAHoldSent = false;
  }
  if (directA && !buttonAHoldSent && buttonAPressedAt > 0 && now - buttonAPressedAt >= kButtonHoldMs) {
    buttonAHoldSent = true;
    if (!sendUiActionForButton("A-hold")) {
      latchButtonHit("A hold");
    }
  }
  if (!directA && lastDirectA) {
    if (!buttonAHoldSent) {
      if (!sendSelectedDeviceUiAction("A") && !sendUiActionForButton("A")) {
        latchButtonHit("A");
      }
    }
    buttonAPressedAt = 0;
  }

  if (directB && !lastDirectB) {
    buttonBPressedAt = now;
    buttonBHoldSent = false;
  }
  if (directB && !buttonBHoldSent && buttonBPressedAt > 0 && now - buttonBPressedAt >= kButtonHoldMs) {
    buttonBHoldSent = true;
    if (!sendUiActionForButton("B-hold")) {
      latchButtonHit("B hold");
    }
  }
  if (!directB && lastDirectB) {
    if (!buttonBHoldSent) {
      if (!selectNextDeviceUiAction() && !sendUiActionForButton("B")) {
        latchButtonHit("B");
      }
    }
    buttonBPressedAt = 0;
  }

  if (directPwr && !lastDirectPwr) {
    buttonPwrPressedAt = now;
    buttonPwrHoldSent = false;
  }
  if (directPwr && !buttonPwrHoldSent && buttonPwrPressedAt > 0 && now - buttonPwrPressedAt >= kButtonHoldMs) {
    buttonPwrHoldSent = true;
    if (!sendUiActionForButton("P-hold")) {
      latchButtonHit("P hold");
      reconnect();
    }
  }
  if (!directPwr && lastDirectPwr) {
    if (!buttonPwrHoldSent) {
      if (!sendBackDeviceUiAction("P") && !sendUiActionForButton("P")) {
        latchButtonHit("P");
      }
    }
    buttonPwrPressedAt = 0;
  }
  lastDirectA = directA;
  lastDirectB = directB;
  lastDirectPwr = directPwr;

#if HAS_M5UNIFIED
  M5.update();
#endif
}
}  // namespace

void setup() {
  Serial.begin(115200);
  pinMode(4, OUTPUT);
  digitalWrite(4, HIGH);
  pinMode(kButtonAGpio, INPUT);
  pinMode(kButtonBGpio, INPUT);
  pinMode(kButtonPwrGpio, INPUT);
  delay(200);

#if HAS_M5UNIFIED
  auto cfg = M5.config();
  M5.begin(cfg);
  M5.Display.setRotation(0);
  M5.Display.setBrightness(100);
  initTheme();
#endif

  mark("vibe minimal boot");
  if (hasRequiredConfig()) {
    connectWifi();
    setupMdns();
    beginWs();
  }
  refreshUi();
}

void loop() {
  ws.loop();

  if (wifiReady && WiFi.status() != WL_CONNECTED) {
    wifiReady = false;
    wsReady = false;
    wsStarted = false;
    wsStartedHost = "";
    wsStartedPort = 0;
    wsPhase = "wifi";
    mdnsReady = false;
    mark("wifi lost");
  }

  if (!wifiReady && hasRequiredConfig()) {
    const unsigned long now = millis();
    if (now - lastWifiAttempt > kWifiRetryIntervalMs) {
      connectWifi();
      if (wifiReady) {
        setupMdns();
        remoteHost = "";
        wsPhase = "search";
        lastDiscoverAt = 0;
        lastReconnectAttempt = 0;
        displayDirty = true;
      }
    }
  }

  if (wifiReady && !wsReady) {
    const unsigned long now = millis();
    if (remoteHost.length() == 0 || now - lastDiscoverAt > kDiscoverIntervalMs) {
      lastDiscoverAt = now;
      wsPhase = "search";
      displayDirty = true;
      String discoveredHost;
      uint16_t discoveredPort = 0;
      if (discoverBridge(discoveredHost, discoveredPort)) {
        remoteHost = discoveredHost;
        remotePort = discoveredPort;
        wsPhase = "conn";
        mark(String("found ") + remoteHost + ":" + String(remotePort));
      } else {
        mark("bridge not found");
      }
    }

    if (now - lastReconnectAttempt > kReconnectIntervalMs) {
      lastReconnectAttempt = now;
      beginWs();
    }
  }

  const unsigned long now = millis();
  if (wsReady && now - lastPingAt > kPingIntervalMs) {
    lastPingAt = now;
    sendPing();
  }

  pollSerial();
  pollButtons();
  refreshUi();
  delay(10);
}
