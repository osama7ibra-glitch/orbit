// Reads the text in a screenshot on the phone, with Tesseract (vendor/tesseract). Nothing leaves the phone.
// The reader (about 7 MB) loads the first time it's used, then works offline.
let ready = null;
let progress = () => {};
const here = (p) => new URL(p, location.href).href;

function loadScript(src) {
  return new Promise((ok, fail) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = ok;
    s.onerror = () => fail(new Error("Orbit couldn't load the screenshot reader. Connect to the internet once and try again."));
    document.head.append(s);
  });
}

/** Text of one image file. onProgress gets Tesseract's { status, progress } updates. */
export async function readText(file, onProgress) {
  progress = onProgress ?? (() => {});
  ready ??= (async () => {
    if (!window.Tesseract) await loadScript(here("vendor/tesseract/tesseract.min.js"));
    return window.Tesseract.createWorker("eng", 1, {
      workerPath: here("vendor/tesseract/worker.min.js"),
      corePath: here("vendor/tesseract/"),
      langPath: here("vendor/tesseract/"),
      workerBlobURL: false, // the page's security rules only allow Orbit's own files
      logger: (m) => progress(m),
    });
  })().catch((e) => { ready = null; throw e; });
  const worker = await ready;
  const { data } = await worker.recognize(file);
  return data.text;
}
