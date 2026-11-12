# Image Metadata Remover

A dependency-free static image metadata remover. Host this folder on a static web host; the root `index.html` serves `/`, and each content page is an `index.html` inside its own directory. There is no build step, backend, or image upload endpoint.

## Supported formats

- **JPEG:** Re-encoded in the browser; output quality is adjustable and may affect image quality.
- **PNG:** Re-encoded as PNG, preserving image pixels losslessly.
- **WebP:** Supported when the browser can decode and export WebP; output is re-encoded and may affect image quality.
- **HEIC / HEIF:** Not supported. These files are rejected rather than uploaded or converted elsewhere.

The tool removes the original embedded metadata by drawing the image into a browser canvas and exporting a new image. This does not remove identifying details visible in the pixels. No remote fonts, libraries, analytics, or image-processing services are used.

Format-specific pages are in `pages/`, privacy guides are in `guides/`, and site privacy/limitations are in `privacy/index.html`. The root `favicon.ico`, `robots.txt`, and `sitemap.xml` are referenced for the production domain. Page canonical URLs use `https://imagemetadataremover.tools/`; publish the folder at that domain or update those URLs before launch.
