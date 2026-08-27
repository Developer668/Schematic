/**
 * Generic protocol bridges — one per interface type, not per-device.
 * Each bridge is stateless and reusable: e.g. I2C bridge handles any I2C sensor.
 * Mirrors Velxio's SignalRouter + I2CBusManager patterns.
 */

export interface I2CTransaction {
  protocol: "i2c";
  controller: string;
  address: number;
  operation: "read" | "write";
  register?: number;
  length: number;
  time_ns: number;
  data?: number[];
}

export interface GpioEvent { pin: string; value: boolean; time_ns: number }
export interface AdcEvent { pin: string; voltage: number; time_ns: number }
export interface PwmEvent { pin: string; duty: number; freqHz: number; time_ns: number }
export interface SpiTransaction { controller: string; data: number[]; time_ns: number }
export interface UartFrame { port: string; data: number[]; baud: number; time_ns: number }

export type BridgeEvent = I2CTransaction | GpioEvent | AdcEvent | PwmEvent | SpiTransaction | UartFrame;

export interface Bridge {
  readonly domain: string;
  handle(event: BridgeEvent): Promise<BridgeEvent | void>;
}

export class GpioBridge implements Bridge {
  readonly domain = "gpio";
  async handle(event: BridgeEvent) {
    if ((event as GpioEvent).pin) return event;
  }
}

export class I2CBridge implements Bridge {
  readonly domain = "i2c";
  // Map address → handler (any sensor model registers here)
  handlers = new Map<number, (tx: I2CTransaction) => Promise<number[] | void>>();
  async handle(event: BridgeEvent) {
    if ((event as I2CTransaction).protocol !== "i2c") return;
    const tx = event as I2CTransaction;
    const h = this.handlers.get(tx.address);
    if (h) {
      const data = await h(tx);
      if (data) return { ...tx, data };
    }
    return tx;
  }
}

export class SpiBridge implements Bridge { readonly domain = "spi"; async handle(e: BridgeEvent) { return e; } }
export class UartBridge implements Bridge { readonly domain = "uart"; async handle(e: BridgeEvent) { return e; } }
export class AdcBridge implements Bridge { readonly domain = "adc"; async handle(e: BridgeEvent) { return e; } }
export class PwmBridge implements Bridge { readonly domain = "pwm"; async handle(e: BridgeEvent) { return e; } }
export class CanBridge implements Bridge { readonly domain = "can"; async handle(e: BridgeEvent) { return e; } }
export class UsbBridge implements Bridge { readonly domain = "usb"; async handle(e: BridgeEvent) { return e; } }
export class MechanicalBridge implements Bridge { readonly domain = "mechanical"; async handle(e: BridgeEvent) { return e; } }
export class RfBridge implements Bridge { readonly domain = "rf"; async handle(e: BridgeEvent) { return e; } }
