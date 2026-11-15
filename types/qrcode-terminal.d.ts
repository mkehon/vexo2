// The QR encoder that ships inside qrcode-terminal, which has no types of its own.
declare module "qrcode-terminal/vendor/QRCode" {
  export default class QRCode {
    constructor(typeNumber: number, errorCorrectLevel: number);
    addData(data: string): void;
    make(): void;
    getModuleCount(): number;
    isDark(row: number, column: number): boolean;
  }
}
declare module "qrcode-terminal/vendor/QRCode/QRErrorCorrectLevel" {
  const levels: { L: number; M: number; Q: number; H: number };
  export default levels;
}
