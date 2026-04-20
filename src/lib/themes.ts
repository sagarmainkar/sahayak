export type ThemeId = "correspondence" | "terminal" | "editorial";

export const THEMES: {
  id: ThemeId;
  name: string;
  tagline: string;
  cls: string;
}[] = [
  {
    id: "correspondence",
    name: "Correspondence",
    tagline: "Letters · warm paper · sienna",
    cls: "theme-correspondence",
  },
  {
    id: "terminal",
    name: "Terminal Scholar",
    tagline: "Mono · ink · amber",
    cls: "theme-terminal",
  },
  {
    id: "editorial",
    name: "Editorial",
    tagline: "Magazine · cream · ochre",
    cls: "theme-editorial",
  },
];
