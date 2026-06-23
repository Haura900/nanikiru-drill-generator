import createMahjongModule from "./mahjong.js";

let modulePromise;

function getModule() {
  modulePromise ||= createMahjongModule({
    locateFile: (path) => new URL(path, import.meta.url).href,
  });
  return modulePromise;
}

self.onmessage = async (event) => {
  const { id, payload } = event.data;
  try {
    const module = await getModule();
    const result = JSON.parse(module.analyzeJson(JSON.stringify(payload)));
    self.postMessage({ id, result });
  } catch (error) {
    self.postMessage({ id, error: error?.message || String(error) });
  }
};

