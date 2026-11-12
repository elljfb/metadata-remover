(() => {
  const fileInput = document.getElementById("image-file");
  if (!fileInput) return;

  const dropZone = document.getElementById("drop-zone");
  const fileSummary = document.getElementById("file-summary");
  const fileName = document.getElementById("file-name");
  const fileInfo = document.getElementById("file-info");
  const cleanButton = document.getElementById("clean-button");
  const removeButton = document.getElementById("remove-file");
  const statusMessage = document.getElementById("status-message");
  const qualityControl = document.getElementById("quality-control");
  const qualityInput = document.getElementById("quality");
  const qualityValue = document.getElementById("quality-value");
  const maxBytes = 20 * 1024 * 1024;
  const maxPixels = 40_000_000;
  const supportedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
  let selectedFile = null;
  let busy = false;

  const formatBytes = (bytes) => {
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const setStatus = (message, isError = false) => {
    statusMessage.textContent = message;
    statusMessage.classList.toggle("error", isError);
  };

  const reset = () => {
    selectedFile = null;
    fileInput.value = "";
    fileSummary.hidden = true;
    qualityControl.hidden = true;
    dropZone.hidden = false;
    cleanButton.disabled = true;
    cleanButton.textContent = "Remove metadata";
    setStatus("");
  };

  const selectFile = (file) => {
    if (!file) return;
    if (!supportedTypes.has(file.type)) {
      reset();
      setStatus("This file type is not supported. Choose a JPEG, PNG, or WebP image. HEIC / HEIF is not supported.", true);
      return;
    }
    if (file.size > maxBytes) {
      reset();
      setStatus("This image is larger than 20 MB. Choose a smaller file.", true);
      return;
    }
    if (file.size === 0) {
      reset();
      setStatus("This file is empty. Choose another image.", true);
      return;
    }

    selectedFile = file;
    fileName.textContent = file.name;
    fileInfo.textContent = `${formatBytes(file.size)} · ${file.type.replace("image/", "").toUpperCase()}`;
    fileSummary.hidden = false;
    qualityControl.hidden = file.type === "image/png";
    dropZone.hidden = true;
    cleanButton.disabled = false;
    setStatus("");
  };

  fileInput.addEventListener("change", () => selectFile(fileInput.files[0]));
  removeButton.addEventListener("click", reset);
  qualityInput.addEventListener("input", () => {
    qualityValue.value = `${qualityInput.value}%`;
    qualityValue.textContent = `${qualityInput.value}%`;
  });

  ["dragenter", "dragover"].forEach((eventName) => {
    dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropZone.classList.add("dragging");
    });
  });
  ["dragleave", "drop"].forEach((eventName) => {
    dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropZone.classList.remove("dragging");
    });
  });
  dropZone.addEventListener("drop", (event) => selectFile(event.dataTransfer.files[0]));

  cleanButton.addEventListener("click", async () => {
    if (!selectedFile || busy) return;
    busy = true;
    cleanButton.disabled = true;
    cleanButton.textContent = "Cleaning image…";
    setStatus("Processing locally in your browser. Please wait.");

    let bitmap;
    try {
      bitmap = await createImageBitmap(selectedFile);
      if (bitmap.width * bitmap.height > maxPixels) {
        throw new Error("This image has too many pixels to process safely in the browser.");
      }
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Your browser could not create an image canvas.");
      context.drawImage(bitmap, 0, 0);

      const outputType = selectedFile.type;
      const quality = Number(qualityInput.value) / 100;
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, outputType, quality));
      if (!blob) throw new Error("Your browser could not create the cleaned image.");
      if (blob.type !== outputType) {
        throw new Error(`Your browser cannot export ${outputType.replace("image/", "").toUpperCase()} images. Try a different browser or format.`);
      }

      const extension = outputType === "image/jpeg" ? "jpg" : outputType.split("/")[1];
      const baseName = selectedFile.name.replace(/\.[^.]+$/, "");
      const downloadUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = `${baseName}-metadata-removed.${extension}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
      setStatus("Done. Your clean copy has been downloaded; the original is unchanged.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "The image could not be processed. Try another supported image.", true);
    } finally {
      if (bitmap) bitmap.close();
      busy = false;
      cleanButton.disabled = !selectedFile;
      cleanButton.textContent = "Remove metadata";
    }
  });
})();
