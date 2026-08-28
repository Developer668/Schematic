self.onmessage = (event) => {
  if (event.data?.type !== "increment") {
    self.postMessage({ ok: false, error: "unknown-message" });
    return;
  }
  self.postMessage({ ok: true, value: Number(event.data.value) + 1 });
};
