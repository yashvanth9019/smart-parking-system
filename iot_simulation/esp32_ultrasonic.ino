/*
 * SmartPark RTD - ESP32 + HC-SR04 Ultrasonic Parking Slot Sensor Node
 * Streams real-time occupancy readings to the FastAPI backend over HTTP/JSON.
 */

#include <WiFi.h>
#include <HTTPClient.h>

// WiFi Credentials
const char* WIFI_SSID = "YOUR_WIFI_SSID";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";

// FastAPI Backend Endpoint & IoT Key
const char* API_URL = "http://YOUR_SERVER_IP:8000/api/iot/sensor-data";
const char* IOT_API_KEY = "esp32-smartpark-device-key-2026";
const char* SENSOR_ID = "ESP32-L1-S01";

// HC-SR04 Pins
const int TRIG_PIN = 5;
const int ECHO_PIN = 18;
const int LED_OCCUPIED = 2;

const float OCCUPANCY_THRESHOLD_CM = 100.0;
bool lastDetected = false;
unsigned long lastSendMs = 0;

float measureDistanceCm() {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);

  long duration = pulseIn(ECHO_PIN, HIGH, 30000);
  if (duration == 0) return 250.0;
  return (duration * 0.0343) / 2.0;
}

void sendTelemetry(float distanceCm, bool detected) {
  if (WiFi.status() != WL_CONNECTED) return;

  HTTPClient http;
  http.begin(API_URL);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-IoT-Key", IOT_API_KEY);

  String payload = "{";
  payload += "\"sensor_id\":\"" + String(SENSOR_ID) + "\",";
  payload += "\"distance_cm\":" + String(distanceCm, 1) + ",";
  payload += "\"vehicle_detected\":" + String(detected ? "true" : "false") + ",";
  payload += "\"source\":\"iot_esp32\"";
  payload += "}";

  int code = http.POST(payload);
  Serial.printf("[ESP32] Sent reading: %.1f cm | detected=%d | HTTP %d\n", distanceCm, detected, code);
  http.end();
}

void setup() {
  Serial.begin(115200);
  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  pinMode(LED_OCCUPIED, OUTPUT);

  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("Connecting to WiFi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\nWiFi Connected!");
}

void loop() {
  float dist = measureDistanceCm();
  bool detected = dist < OCCUPANCY_THRESHOLD_CM;
  digitalWrite(LED_OCCUPIED, detected ? HIGH : LOW);

  if (detected != lastDetected || (millis() - lastSendMs) > 15000) {
    sendTelemetry(dist, detected);
    lastDetected = detected;
    lastSendMs = millis();
  }
  delay(1500);
}

