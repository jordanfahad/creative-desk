declare module "arabic-persian-reshaper" {
  /** Reshapes logical Arabic text into Presentation Forms codepoints. */
  export const ArabicShaper: { convertArabic(text: string): string };
  export const PersianShaper: { convertArabic(text: string): string };
}
