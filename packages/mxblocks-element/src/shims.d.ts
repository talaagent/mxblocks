// esbuild bundles .css imports as text (--loader:.css=text).
declare module "*.css" {
  const css: string;
  export default css;
}
