(() => {
  const fileInput = document.getElementById("metadata-file");
  if (!fileInput) return;

  const inspectButton = document.getElementById("inspect-button");
  const fileSummary = document.getElementById("metadata-file-summary");
  const fileName = document.getElementById("metadata-file-name");
  const fileInfo = document.getElementById("metadata-file-info");
  const results = document.getElementById("metadata-results");
  const resultRows = document.getElementById("metadata-result-rows");
  const status = document.getElementById("metadata-status");
  const removeButton = document.getElementById("remove-metadata-file");
  const maxBytes = 20 * 1024 * 1024;
  const knownTypes = new Map([
    [1, ["byte", 1]],
    [2, ["ascii", 1]],
    [3, ["short", 2]],
    [4, ["long", 4]],
    [5, ["rational", 8]],
    [7, ["undefined", 1]],
    [8, ["sshort", 2]],
    [9, ["slong", 4]],
    [10, ["srational", 8]],
    [11, ["float", 4]],
    [12, ["double", 8]]
  ]);
  const exifLabels = new Map([
    [0x010e, "Image description"],
    [0x010f, "Camera make"],
    [0x0110, "Camera model"],
    [0x0112, "Orientation"],
    [0x0131, "Software"],
    [0x0132, "Date and time"],
    [0x013b, "Artist"],
    [0x8298, "Copyright"],
    [0x829a, "Exposure time"],
    [0x829d, "F-number"],
    [0x8822, "Exposure program"],
    [0x8827, "ISO speed"],
    [0x9003, "Original date and time"],
    [0x9004, "Digitized date and time"],
    [0x9201, "Shutter speed"],
    [0x9202, "Aperture"],
    [0x9204, "Exposure bias"],
    [0x9207, "Metering mode"],
    [0x9209, "Flash"],
    [0x920a, "Focal length"],
    [0xa002, "Image width"],
    [0xa003, "Image height"],
    [0xa434, "Lens model"]
  ]);
  const gpsLabels = new Map([
    [0x0001, "GPS latitude reference"],
    [0x0002, "GPS latitude"],
    [0x0003, "GPS longitude reference"],
    [0x0004, "GPS longitude"],
    [0x0005, "GPS altitude reference"],
    [0x0006, "GPS altitude"],
    [0x001d, "GPS date"]
  ]);
  let selectedFile = null;
  let busy = false;

  const formatBytes = (bytes) => bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

  const setStatus = (message, isError = false) => {
    status.textContent = message;
    status.classList.toggle("error", isError);
  };

  const reset = () => {
    selectedFile = null;
    fileInput.value = "";
    fileSummary.hidden = true;
    results.hidden = true;
    inspectButton.disabled = true;
    setStatus("");
  };

  const selectFile = (file) => {
    if (!file) return;
    reset();
    if (file.size === 0) {
      setStatus("This file is empty. Choose another image.", true);
      return;
    }
    if (file.size > maxBytes) {
      setStatus("This image is larger than 20 MB. Choose a smaller file.", true);
      return;
    }

    selectedFile = file;
    fileName.textContent = file.name;
    fileInfo.textContent = `${formatBytes(file.size)}${file.type ? ` · ${file.type}` : ""}`;
    fileSummary.hidden = false;
    inspectButton.disabled = false;
    setStatus("");
  };

  const decodeAscii = (bytes, start, length) =>
    new TextDecoder("ascii").decode(bytes.subarray(start, start + length)).replace(/\0+$/, "").trim();

  const hasBytes = (bytes, start, signature) =>
    start + signature.length <= bytes.length &&
    signature.every((value, index) => bytes[start + index] === value);

  const hasAscii = (bytes, start, value) =>
    hasBytes(bytes, start, Array.from(value, (character) => character.charCodeAt(0)));

  const readTiff = (bytes, start, rows, blocks) => {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (start + 8 > bytes.length) throw new Error("The EXIF block is incomplete.");
    const byteOrder = decodeAscii(bytes, start, 2);
    if (byteOrder !== "II" && byteOrder !== "MM") throw new Error("The EXIF byte order is invalid.");
    const littleEndian = byteOrder === "II";
    if (view.getUint16(start + 2, littleEndian) !== 42) throw new Error("The EXIF header is invalid.");
    const pending = [{ offset: view.getUint32(start + 4, littleEndian), group: "image" }];
    const seen = new Set();
    const gps = {};

    while (pending.length) {
      const { offset, group } = pending.pop();
      if (!offset || seen.has(`${offset}:${group}`)) continue;
      seen.add(`${offset}:${group}`);
      const ifd = start + offset;
      if (ifd + 2 > bytes.length) throw new Error("The EXIF directory is outside the image.");
      const entryCount = Math.min(view.getUint16(ifd, littleEndian), 512);

      for (let index = 0; index < entryCount; index += 1) {
        const entry = ifd + 2 + index * 12;
        if (entry + 12 > bytes.length) throw new Error("The EXIF directory is incomplete.");
        const tag = view.getUint16(entry, littleEndian);
        const type = view.getUint16(entry + 2, littleEndian);
        const count = view.getUint32(entry + 4, littleEndian);
        const typeInfo = knownTypes.get(type);
        if (!typeInfo || !count || count > 256) continue;

        const [typeName, typeSize] = typeInfo;
        const valueBytes = count * typeSize;
        const valueStart = valueBytes <= 4 ? entry + 8 : start + view.getUint32(entry + 8, littleEndian);
        if (valueStart < start || valueStart + valueBytes > bytes.length) continue;
        let value;

        if (typeName === "ascii") {
          value = decodeAscii(bytes, valueStart, count);
        } else if (typeName === "undefined") {
          continue;
        } else {
          const readers = {
            byte: (position) => view.getUint8(position),
            short: (position) => view.getUint16(position, littleEndian),
            long: (position) => view.getUint32(position, littleEndian),
            rational: (position) => {
              const denominator = view.getUint32(position + 4, littleEndian);
              return denominator ? view.getUint32(position, littleEndian) / denominator : null;
            },
            sshort: (position) => view.getInt16(position, littleEndian),
            slong: (position) => view.getInt32(position, littleEndian),
            srational: (position) => {
              const denominator = view.getInt32(position + 4, littleEndian);
              return denominator ? view.getInt32(position, littleEndian) / denominator : null;
            },
            float: (position) => view.getFloat32(position, littleEndian),
            double: (position) => view.getFloat64(position, littleEndian)
          };
          const step = typeName === "rational" || typeName === "srational" ? 8 : typeSize;
          const reader = readers[typeName];
          const values = Array.from({ length: count }, (_, item) => reader(valueStart + item * step));
          value = values.length === 1 ? values[0] : values;
        }

        if (group === "gps") {
          gps[tag] = value;
          const label = gpsLabels.get(tag);
          if (label) rows.set(label, value);
        } else {
          const label = exifLabels.get(tag);
          if (label && value !== "") rows.set(label, value);
          if (tag === 0x8769 && typeof value === "number") pending.push({ offset: value, group: "exif" });
          if (tag === 0x8825 && typeof value === "number") pending.push({ offset: value, group: "gps" });
        }
      }
    }

    const latitude = gps[0x0002];
    const longitude = gps[0x0004];
    if (Array.isArray(latitude) && latitude.length >= 3 && Array.isArray(longitude) && longitude.length >= 3) {
      const toDecimal = (parts) => parts[0] + parts[1] / 60 + parts[2] / 3600;
      let lat = toDecimal(latitude);
      let lon = toDecimal(longitude);
      if (String(gps[0x0001]).toUpperCase() === "S") lat *= -1;
      if (String(gps[0x0003]).toUpperCase() === "W") lon *= -1;
      rows.set("GPS coordinates", `${lat.toFixed(6)}, ${lon.toFixed(6)}`);
    }
    if (gps[0x0006] !== undefined) {
      const altitude = Array.isArray(gps[0x0006]) ? gps[0x0006][0] : gps[0x0006];
      rows.set("GPS altitude", `${gps[0x0005] === 1 ? "-" : ""}${altitude} m`);
    }
    blocks.add("EXIF");
  };

  const parseJpeg = (bytes, rows, blocks) => {
    let offset = 2;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset] !== 0xff) break;
      while (bytes[offset] === 0xff) offset += 1;
      const marker = bytes[offset++];
      if (marker === 0xd9 || marker === 0xda) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > bytes.length) break;
      const length = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(offset, false);
      const dataStart = offset + 2;
      const dataEnd = offset + length;
      if (length < 2 || dataEnd > bytes.length) throw new Error("The JPEG contains an incomplete metadata segment.");

      if (marker === 0xe1 && hasBytes(bytes, dataStart, [0x45, 0x78, 0x69, 0x66, 0, 0])) {
        readTiff(bytes, dataStart + 6, rows, blocks);
      } else if (marker === 0xe1 && hasAscii(bytes, dataStart, "http://ns.adobe.com/xap/1.0/\0")) {
        blocks.add("XMP");
      } else if (marker === 0xed && hasAscii(bytes, dataStart, "Photoshop 3.0\0")) {
        let resource = dataStart + 14;
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        while (resource + 12 <= dataEnd && hasAscii(bytes, resource, "8BIM")) {
          const resourceId = view.getUint16(resource + 4, false);
          const nameLength = bytes[resource + 6];
          const sizeOffset = resource + 7 + nameLength + ((nameLength + 1) % 2);
          if (sizeOffset + 4 > dataEnd) break;
          const resourceSize = view.getUint32(sizeOffset, false);
          const resourceEnd = sizeOffset + 4 + resourceSize;
          if (resourceEnd > dataEnd) break;
          if (resourceId === 0x0404) blocks.add("IPTC");
          resource = resourceEnd + (resourceSize % 2);
        }
      } else if (marker === 0xe2 && hasBytes(bytes, dataStart, [0x49, 0x43, 0x43, 0x5f, 0x50, 0x52, 0x4f, 0x46, 0x49, 0x4c, 0x45])) {
        blocks.add("ICC color profile");
      } else if (marker === 0xfe) {
        blocks.add("JPEG comment");
        const comment = decodeAscii(bytes, dataStart, dataEnd - dataStart);
        if (comment) rows.set("JPEG comment", comment.slice(0, 300));
      }
      offset = dataEnd;
    }
  };

  const parsePng = (bytes, rows, blocks) => {
    let offset = 8;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    while (offset + 12 <= bytes.length) {
      const length = view.getUint32(offset, false);
      const kind = decodeAscii(bytes, offset + 4, 4);
      const dataStart = offset + 8;
      const dataEnd = dataStart + length;
      if (dataEnd + 4 > bytes.length) throw new Error("The PNG contains an incomplete chunk.");

      if (kind === "eXIf") {
        readTiff(bytes, dataStart, rows, blocks);
      } else if (kind === "iCCP") {
        blocks.add("ICC color profile");
      } else if (kind === "tEXt") {
        blocks.add("PNG text");
        const separator = bytes.indexOf(0, dataStart);
        if (separator >= dataStart && separator < dataEnd) {
          const keyword = decodeAscii(bytes, dataStart, separator - dataStart);
          const value = decodeAscii(bytes, separator + 1, dataEnd - separator - 1);
          if (keyword && value) rows.set(`PNG: ${keyword}`, value.slice(0, 300));
        }
      } else if (kind === "zTXt") {
        blocks.add("PNG compressed text");
      } else if (kind === "iTXt") {
        blocks.add("PNG international text");
        const separator = bytes.indexOf(0, dataStart);
        if (separator >= dataStart && separator < dataEnd) {
          const keyword = decodeAscii(bytes, dataStart, separator - dataStart);
          if (keyword === "XML:com.adobe.xmp") blocks.add("XMP");
          const compressionFlag = bytes[separator + 1];
          if (compressionFlag === 0) {
            let textStart = separator + 3;
            for (let field = 0; field < 2; field += 1) {
              const end = bytes.indexOf(0, textStart);
              if (end < 0 || end >= dataEnd) break;
              textStart = end + 1;
            }
            if (textStart <= dataEnd && keyword) {
              const value = new TextDecoder("utf-8").decode(bytes.subarray(textStart, dataEnd));
              if (value) rows.set(`PNG: ${keyword}`, value.slice(0, 300));
            }
          }
        }
      }
      offset = dataEnd + 4;
      if (kind === "IEND") break;
    }
  };

  const parseWebp = (bytes, rows, blocks) => {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = 12;
    while (offset + 8 <= bytes.length) {
      const kind = decodeAscii(bytes, offset, 4);
      const length = view.getUint32(offset + 4, true);
      const dataStart = offset + 8;
      const dataEnd = dataStart + length;
      if (dataEnd > bytes.length) throw new Error("The WebP contains an incomplete chunk.");
      if (kind === "EXIF") {
        const prefixLength = hasBytes(bytes, dataStart, [0x45, 0x78, 0x69, 0x66, 0, 0]) ? 6 : 0;
        readTiff(bytes.subarray(0, dataEnd), dataStart + prefixLength, rows, blocks);
      } else if (kind === "XMP ") {
        blocks.add("XMP");
      } else if (kind === "ICCP") {
        blocks.add("ICC color profile");
      }
      offset = dataEnd + (length % 2);
    }
  };

  const inspect = (buffer) => {
    const bytes = new Uint8Array(buffer);
    const rows = new Map();
    const blocks = new Set();
    if (hasBytes(bytes, 0, [0xff, 0xd8])) {
      parseJpeg(bytes, rows, blocks);
      return { format: "JPEG", rows, blocks };
    }
    if (hasBytes(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
      parsePng(bytes, rows, blocks);
      return { format: "PNG", rows, blocks };
    }
    if (hasBytes(bytes, 0, [0x52, 0x49, 0x46, 0x46]) && hasBytes(bytes, 8, [0x57, 0x45, 0x42, 0x50])) {
      parseWebp(bytes, rows, blocks);
      return { format: "WebP", rows, blocks };
    }
    throw new Error("This file is not a supported JPEG, PNG, or WebP image.");
  };

  window.ImageMetadataViewerParser = Object.freeze({ inspect });

  const renderResults = (file, metadata) => {
    resultRows.replaceChildren();
    const details = [
      ["File", file.name],
      ["Format", metadata.format],
      ["File size", formatBytes(file.size)],
      ["Metadata blocks", metadata.blocks.size ? [...metadata.blocks].join(", ") : "No supported metadata blocks found"]
    ];
    for (const [label, value] of [...details, ...metadata.rows]) {
      const term = document.createElement("dt");
      const description = document.createElement("dd");
      term.textContent = label;
      description.textContent = Array.isArray(value) ? value.join(", ") : String(value);
      resultRows.append(term, description);
    }
    results.hidden = false;
  };

  fileInput.addEventListener("change", () => selectFile(fileInput.files[0]));
  removeButton.addEventListener("click", reset);
  inspectButton.addEventListener("click", async () => {
    if (!selectedFile || busy) return;
    const file = selectedFile;
    busy = true;
    fileInput.disabled = true;
    removeButton.disabled = true;
    inspectButton.disabled = true;
    inspectButton.textContent = "Reading metadata…";
    results.hidden = true;
    setStatus("Inspecting locally in your browser. The viewer code does not upload the image.");
    try {
      const metadata = window.ImageMetadataViewerParser.inspect(await file.arrayBuffer());
      renderResults(file, metadata);
      setStatus(metadata.blocks.size
        ? `Inspection complete. Detected: ${[...metadata.blocks].join(", ")}.`
        : "Inspection complete. No supported metadata blocks were found.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "The image metadata could not be read.", true);
    } finally {
      busy = false;
      fileInput.disabled = false;
      removeButton.disabled = false;
      inspectButton.disabled = !selectedFile;
      inspectButton.textContent = "View photo metadata";
    }
  });
})();
