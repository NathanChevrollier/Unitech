/// <reference lib="webworker" />
import { generateGalaxy } from "./generate";

self.onmessage = (e: MessageEvent<{ seed: number; total: number; id: number }>) => {
  const { seed, total, id } = e.data;
  const data = generateGalaxy(seed, total);
  const transfer = [data.light, data.dust].flatMap((l) => [l.positions.buffer, l.colors.buffer, l.sizes.buffer]);
  (self as unknown as Worker).postMessage({ id, data }, transfer);
};
