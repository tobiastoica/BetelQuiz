export const THEMES = [
  { id: 'standard', name: 'Cosmic Midnight', gradient: 'from-[#161D48] via-[#0F1433] to-[#080A1F]', isDark: true },
  { id: 'cosmic', name: 'Cosmic Aurora', gradient: 'from-[#1F2A6A] via-[#0F1433] to-[#080A1F]', isDark: true },
  { id: 'purple', name: 'Electric Violet', gradient: 'from-[#2e1065] via-[#1e1b4b] to-[#080a1f]', isDark: true },
  { id: 'spring', name: 'Spring Blossom', gradient: 'from-[#064e3b] via-[#022c22] to-[#080a1f]', isDark: true },
  { id: 'summer', name: 'Summer Azure', gradient: 'from-[#0c4a6e] via-[#07273c] to-[#080a1f]', isDark: true },
  { id: 'autumn', name: 'Autumn Amber', gradient: 'from-[#78350f] via-[#451a03] to-[#080a1f]', isDark: true },
  { id: 'winter', name: 'Winter Frost', gradient: 'from-[#172554] via-[#0f172a] to-[#080a1f]', isDark: true },
  { id: 'dark', name: 'Onyx Black', gradient: 'from-[#18181b] via-[#09090b] to-[#000000]', isDark: true },
];

export function getThemeClasses(themeId?: string, customBg?: string): { className: string; style?: React.CSSProperties } {
  if (customBg) {
    return {
      className: 'bg-cover bg-center bg-no-repeat',
      style: { backgroundImage: `url(${customBg})` },
    };
  }

  const theme = THEMES.find((t) => t.id === themeId) || THEMES[0];
  return {
    className: `bg-gradient-to-br ${theme.gradient}`,
  };
}
