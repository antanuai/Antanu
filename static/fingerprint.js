/* اثر انگشت دستگاه (Device Fingerprint)
   نکته فنی: مرورگرها به دلایل امنیتی اجازه خواندن مک‌آدرس را نمی‌دهند؛
   به جای آن ترکیبی از مشخصات دستگاه ساخته و هش می‌شود تا هر کد فقط روی یک دستگاه کار کند. */

async function getFingerprint() {
  try {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    ctx.textBaseline = "top";
    ctx.font = "16px Arial";
    ctx.fillStyle = "#2dd4bf";
    ctx.fillText("ANTANU-device-check-آنتانو", 2, 4);

    const parts = [
      navigator.userAgent,
      navigator.language,
      navigator.hardwareConcurrency || "",
      navigator.platform || "",
      screen.width + "x" + screen.height,
      screen.colorDepth,
      new Date().getTimezoneOffset(),
      Intl.DateTimeFormat().resolvedOptions().timeZone || "",
      canvas.toDataURL(),
    ].join("||");

    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(parts));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
  } catch (e) {
    return "fp-error-" + (navigator.userAgent || "").length;
  }
}

/* پر کردن خودکار فیلد مخفی fingerprint در فرم‌های ورود/ثبت‌نام */
document.addEventListener("DOMContentLoaded", async () => {
  const fields = document.querySelectorAll("input[name='fingerprint']");
  if (!fields.length) return;
  const fp = await getFingerprint();
  fields.forEach(f => (f.value = fp));
});
