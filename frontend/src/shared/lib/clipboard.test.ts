import { copyText } from "./clipboard";

afterEach(() => vi.unstubAllGlobals());
it("copies using the Clipboard API when available", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  await copyText("/media/movie.mkv");
  expect(writeText).toHaveBeenCalledWith("/media/movie.mkv");
});
it("supports HTTP installations and restores focus after copying", async () => {
  vi.stubGlobal("navigator", {});
  const original = document.execCommand;
  document.execCommand = vi.fn(() => true);
  const button = document.createElement("button");
  document.body.append(button);
  button.focus();
  try {
    await copyText("/media/movie.mkv");
    expect(document.execCommand).toHaveBeenCalledWith("copy");
    expect(document.activeElement).toBe(button);
    expect(document.querySelector("textarea")).toBeNull();
  } finally {
    document.execCommand = original;
    button.remove();
  }
});
