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
  /** Runtime name shown as a small pill (e.g. "Hermes", "OpenCode"). */
  runtimeLabel?: string;
  /** Runtime accent color for the pill. */
  runtimeColor?: string;
  /** When true, the worker's evidence is stale and the label is dimmed. */
  stale?: boolean;
}

export function createWorkerLabelTexture({
  statusLabel,
  statusColor,
  goal,
  runtimeLabel,
  runtimeColor,
  stale = false,
}: WorkerLabelTextureInput): THREE.CanvasTexture {
  const width = 384;
  const height = 144;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");

  if (ctx) {
    ctx.clearRect(0, 0, width, height);
    ctx.globalAlpha = stale ? 0.62 : 1;

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

    if (runtimeLabel) {
      const accent = runtimeColor ?? "#a1a1aa";
      ctx.font = `700 18px ${MONO_STACK}`;
      const label = runtimeLabel.toUpperCase();
      const textWidth = ctx.measureText(label).width;
      const pillRight = width - 24;
      const pillWidth = textWidth + 24;
      const pillLeft = pillRight - pillWidth;

      roundedRect(ctx, pillLeft, 30, pillWidth, 36, 18);
      ctx.fillStyle = `${accent}33`;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = `${accent}cc`;
      ctx.stroke();

      ctx.fillStyle = accent;
      ctx.textAlign = "center";
      ctx.fillText(label, pillLeft + pillWidth / 2, 49);
      ctx.textAlign = "left";
    }

    ctx.font = `500 28px ${MONO_STACK}`;
    ctx.fillStyle = stale ? "#a1a1aa" : "#d4d4d8";
    ctx.fillText(fitText(ctx, goal, width - 48), 24, 106);

    ctx.globalAlpha = 1;
  }

  return finalize(canvas);
}

export function createBadgeTexture(
  text: string,
  color = "#d4d4d8",
): THREE.CanvasTexture {
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
    ctx.strokeStyle = `${color}66`;
    ctx.stroke();

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `700 28px ${MONO_STACK}`;
    ctx.fillStyle = color;
    ctx.fillText(text.toUpperCase(), width / 2, height / 2);
  }

  return finalize(canvas);
}
