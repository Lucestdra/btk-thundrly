// Vite supports `?raw` imports that yield the file contents as a string.
// Used by fixture-driven tests to load HTML snapshots into jsdom.
declare module "*.html?raw" {
  const content: string;
  export default content;
}
