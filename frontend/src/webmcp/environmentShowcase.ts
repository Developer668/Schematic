import { invokeWebMCPTool } from "./tools.ts";

const FIRMWARE = `#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <Adafruit_BMP280.h>
#include <DHT.h>

constexpr int SCREEN_WIDTH = 128;
constexpr int SCREEN_HEIGHT = 64;
constexpr int DHT_PIN = 4;
Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, -1);
Adafruit_BMP280 bmp;
DHT dht(DHT_PIN, DHT22);

void drawDashboard(float temperature, float pressure, float humidity) {
  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  display.setTextSize(1);
  display.setCursor(0, 0); display.println("ENVIRONMENT // LIVE");
  display.drawLine(0, 10, 127, 10, SSD1306_WHITE);
  display.setTextSize(2);
  display.setCursor(0, 17); display.print(temperature, 1); display.print(" C");
  display.setTextSize(1);
  display.setCursor(0, 41); display.print(pressure, 1); display.println(" hPa");
  display.setCursor(0, 53); display.print(humidity, 1); display.print(" %RH");
  display.display();
}

void setup() {
  Serial.begin(115200);
  Wire.begin();
  dht.begin();
  if (!display.begin(SSD1306_SWITCHCAPVCC, 0x3C)) {
    Serial.println("SSD1306 initialization failed");
    while (true) delay(1000);
  }
  if (!bmp.begin(0x76)) Serial.println("BMP280 initialization failed");
}

void loop() {
  const float temperature = bmp.readTemperature();
  const float pressure = bmp.readPressure() / 100.0F;
  const float humidity = dht.readHumidity();
  drawDashboard(temperature, pressure, humidity);
  Serial.printf("T=%.1fC P=%.1fhPa RH=%.1f%%\\n", temperature, pressure, humidity);
  delay(1000);
}
`;

async function callTool(name: string, args: Record<string, unknown> = {}) {
  const result = await invokeWebMCPTool(name, args);
  if (result?.isError) throw new Error(result.content?.[0]?.text ?? `${name} failed`);
  return result;
}

export interface EnvironmentShowcase {
  boardId: string;
  bmp280Id: string;
  dht22Id: string;
  displayId: string;
  connectionCount: number;
}

/** Builds the entire example exclusively through the public WebMCP callbacks. */
export async function buildEnvironmentShowcase(): Promise<EnvironmentShowcase> {
  await callTool("project.clear");
  await callTool("project.rename", { name: "Atmospheric Command Center" });
  await callTool("component.search", { query: "ESP32-S3" });
  await callTool("component.search", { query: "environment display" });

  const boardId = (await callTool("component.add", { componentId: "esp32-s3", x: 70, y: 185 })).data.instanceId;
  const bmp280Id = (await callTool("component.add", { componentId: "bmp280", x: 390, y: 55 })).data.instanceId;
  const dht22Id = (await callTool("component.add", { componentId: "dht22", x: 700, y: 80 })).data.instanceId;
  const displayId = (await callTool("component.add", { componentId: "ssd1306", x: 430, y: 330 })).data.instanceId;

  const connections = [
    [boardId, "3V3", bmp280Id, "VCC"], [boardId, "GND", bmp280Id, "GND"],
    [boardId, "SDA", bmp280Id, "SDA"], [boardId, "SCL", bmp280Id, "SCL"],
    [boardId, "3V3", displayId, "VCC"], [boardId, "GND", displayId, "GND"],
    [boardId, "SDA", displayId, "SDA"], [boardId, "SCL", displayId, "SCL"],
    [boardId, "3V3", dht22Id, "VCC"], [boardId, "GND", dht22Id, "GND"],
    [dht22Id, "DATA", boardId, "GPIO4"],
  ];
  for (const [sourceComponentId, sourcePortId, targetComponentId, targetPortId] of connections) {
    await callTool("connection.connect", { sourceComponentId, sourcePortId, targetComponentId, targetPortId });
  }

  await callTool("firmware.write", { componentId: boardId, files: [{ name: "atmospheric-command-center.ino", content: FIRMWARE }] });
  await callTool("simulation.set_input", { componentId: bmp280Id, key: "temperatureC", value: 23.8 });
  await callTool("simulation.set_input", { componentId: bmp280Id, key: "pressureHpa", value: 1012.6 });
  await callTool("simulation.set_input", { componentId: dht22Id, key: "humidityPct", value: 52.4 });
  await callTool("validation.check");

  return { boardId, bmp280Id, dht22Id, displayId, connectionCount: connections.length };
}
