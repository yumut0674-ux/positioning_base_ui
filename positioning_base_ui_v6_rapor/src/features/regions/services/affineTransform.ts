import type { CalibrationPoint, CoordinatePair } from "../types/region.types";

type Coefficients = readonly [number, number, number];

function solve3(matrix: number[][], values: number[]): Coefficients {
  const rows = matrix.map((row, index) => [...row, values[index]]);
  for (let column = 0; column < 3; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < 3; row += 1) {
      if (Math.abs(rows[row][column]) > Math.abs(rows[pivot][column])) pivot = row;
    }
    [rows[column], rows[pivot]] = [rows[pivot], rows[column]];
    if (Math.abs(rows[column][column]) < 1e-9) throw new Error("Kalibrasyon noktaları doğrusal olamaz.");
    const divisor = rows[column][column];
    for (let index = column; index < 4; index += 1) rows[column][index] /= divisor;
    for (let row = 0; row < 3; row += 1) {
      if (row === column) continue;
      const factor = rows[row][column];
      for (let index = column; index < 4; index += 1) rows[row][index] -= factor * rows[column][index];
    }
  }
  return [rows[0][3], rows[1][3], rows[2][3]];
}

function fit(points: readonly CalibrationPoint[], axis: "x" | "y"): Coefficients {
  if (points.length < 3) throw new Error("En az üç kalibrasyon noktası gerekir.");
  const sums = points.reduce((result, point) => {
    const x = point.pixel.x;
    const y = point.pixel.y;
    const target = point.world[axis];
    result.xx += x * x; result.xy += x * y; result.x += x;
    result.yy += y * y; result.y += y; result.xt += x * target;
    result.yt += y * target; result.t += target;
    return result;
  }, { xx: 0, xy: 0, x: 0, yy: 0, y: 0, xt: 0, yt: 0, t: 0 });
  return solve3(
    [[sums.xx, sums.xy, sums.x], [sums.xy, sums.yy, sums.y], [sums.x, sums.y, points.length]],
    [sums.xt, sums.yt, sums.t],
  );
}

export function createAffineTransform(points: readonly CalibrationPoint[]) {
  const xCoefficients = fit(points, "x");
  const yCoefficients = fit(points, "y");
  return (pixel: CoordinatePair["pixel"]): CoordinatePair["world"] => ({
    x: xCoefficients[0] * pixel.x + xCoefficients[1] * pixel.y + xCoefficients[2],
    y: yCoefficients[0] * pixel.x + yCoefficients[1] * pixel.y + yCoefficients[2],
  });
}

export function createInverseAffineTransform(points: readonly CalibrationPoint[]) {
  const reversed: readonly CalibrationPoint[] = points.map((point) => ({
    id: point.id,
    pixel: point.world,
    world: point.pixel,
  }));
  return createAffineTransform(reversed);
}

export function withWorldCoordinates(
  pixel: CoordinatePair["pixel"],
  transform: ReturnType<typeof createAffineTransform>,
): CoordinatePair {
  const world = transform(pixel);
  return {
    pixel: { x: Math.round(pixel.x * 100) / 100, y: Math.round(pixel.y * 100) / 100 },
    world: { x: Math.round(world.x * 1000) / 1000, y: Math.round(world.y * 1000) / 1000 },
  };
}
