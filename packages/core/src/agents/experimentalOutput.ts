export function setExperimentalOutput<OUTPUT>(
  result: unknown,
  output: OUTPUT,
) {
  Object.defineProperty(result as object, "experimental_output", {
    configurable: true,
    enumerable: false,
    value: output,
    writable: false,
  });
}
