/** Join the class names that apply, skipping the ones that do not. */
export function cx(...names: Array<string | false | null | undefined>): string {
  return names.filter(Boolean).join(" ");
}
