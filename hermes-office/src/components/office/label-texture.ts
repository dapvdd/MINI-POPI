import * as THREE from "three";

/**
 * Procedural label textures for the office. Canvas textures avoid drei `Html`
 * portals (which drop entries unpredictably) and any external font/model asset,
 * while staying crisp in the WebGL scene.
 */

type Canvas2D = CanvasRenderingContext2D;

const MONO_STACK =
  "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

function roundedRect(
  ctx: Canvas2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

function fitText(ctx: Canvas2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) {
    return text;
  }

  let result = text;

  while (
    result.length > 1 &&
    ctx.measureText(`${result}…`).width > maxWidth
  ) {
    result = result.slice(0, -1);
  }

  return `${result}…`;
}

function finalize(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;

  return texture;
}

export interface WorkerLabelTextureInput {
  statusLabel: string;
  statusColor: string;
  goal: string;
}

export function createWorkerLabelTexture({
  statusLabel,
  statusColor,
  goal,
}: WorkerLabelTextureInput): THREE.CanvasTexture {
  const width = 384;
  const height = 144;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");

  if (ctx) {
    ctx.clearRect(0, 0, width, height);

    roundedRect(ctx, 8, 8, width - 16, height - 16, 20);
    ctx.fillStyle = "rgba(9, 9, 11, 0.86)";
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = `${statusColor}aa`;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(42, 48, 10, 0, Math.PI * 2);
    ctx.fillStyle = statusColor;
    ctx.fill();

    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.font = `700 24px ${MONO_STACK}`;
    ctx.fillStyle = statusColor;
    ctx.fillText(statusLabel.toUpperCase(), 62, 50);

    ctx.font = `500 28px ${MONO_STACK}`;
    ctx.fillStyle = "#d4d4d8";
    ctx.fillText(fitText(ctx, goal, width - 48), 24, 106);
  }

  return finalize(canvas);
}

export function createBadgeTexture(text: string): THREE.CanvasTexture {
  const width = 384;
  const height = 96;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");

  if (ctx) {
    ctx.clearRect(0, 0, width, height);

    roundedRect(ctx, 8, 8, width - 16, height - 16, 18);
    ctx.fillStyle = "rgba(9, 9, 11, 0.86)";
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = "#3f3f46";
    ctx.stroke();

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `700 28px ${MONO_STACK}`;
    ctx.fillStyle = "#d4d4d8";
    ctx.fillText(text.toUpperCase(), width / 2, height / 2);
  }

  return finalize(canvas);
}
