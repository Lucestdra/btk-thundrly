// Twitter card reuses the same image as OpenGraph — Next.js will request
// `/twitter-image` separately, so we forward to the default export of the
// opengraph-image module to keep one source.

export { default, alt, size, contentType, runtime } from "./opengraph-image";
