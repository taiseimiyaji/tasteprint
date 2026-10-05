// Uploads are PNG, but legacy imports can retain their original JPEG/WebP bytes.
// Identify those formats without re-encoding assets or rejecting old unknown bytes.
export function referenceImageMediaType(image: Buffer) {
  if (image.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])))
    return "image/jpeg";
  if (
    image.length >= 12 &&
    image.subarray(0, 4).equals(Buffer.from("RIFF")) &&
    image.subarray(8, 12).equals(Buffer.from("WEBP"))
  )
    return "image/webp";
  return "image/png";
}
