import type { Point2D } from "@/src/shared/types/geometry";
import type { MapCalibration, ViewportState } from "../types/map.types";

/** The only boundary between persisted world coordinates and canvas pixels. */
export class CoordinateTransformService {
  public constructor(private readonly calibration: MapCalibration) {}

  public worldToCanvas(point: Point2D): Point2D {
    const localX = point.x - this.calibration.worldOrigin.x;
    const localY = point.y - this.calibration.worldOrigin.y;
    const yDirection = this.calibration.invertYAxis ? -1 : 1;
    const angle = (this.calibration.rotationDegrees * Math.PI) / 180;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const rotatedX = localX * cos - localY * yDirection * sin;
    const rotatedY = localX * sin + localY * yDirection * cos;

    return {
      x: this.calibration.canvasOrigin.x + rotatedX * this.calibration.pixelsPerMeter,
      y: this.calibration.canvasOrigin.y + rotatedY * this.calibration.pixelsPerMeter,
    };
  }

  public canvasToWorld(point: Point2D): Point2D {
    const pixelX = (point.x - this.calibration.canvasOrigin.x) / this.calibration.pixelsPerMeter;
    const pixelY = (point.y - this.calibration.canvasOrigin.y) / this.calibration.pixelsPerMeter;
    const angle = (-this.calibration.rotationDegrees * Math.PI) / 180;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const rotatedX = pixelX * cos - pixelY * sin;
    const rotatedY = pixelX * sin + pixelY * cos;
    const yDirection = this.calibration.invertYAxis ? -1 : 1;

    return {
      x: rotatedX + this.calibration.worldOrigin.x,
      y: rotatedY * yDirection + this.calibration.worldOrigin.y,
    };
  }

  public viewportToCanvas(point: Point2D, viewport: ViewportState): Point2D {
    return {
      x: (point.x - viewport.x) / viewport.scale,
      y: (point.y - viewport.y) / viewport.scale,
    };
  }

  public screenToWorld(point: Point2D, viewport: ViewportState): Point2D {
    return this.canvasToWorld(this.viewportToCanvas(point, viewport));
  }

  public metersToPixels(meters: number): number {
    return meters * this.calibration.pixelsPerMeter;
  }
}
