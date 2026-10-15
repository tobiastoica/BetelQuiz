export const THEMES = [
  { id: 'standard', name: 'Standard Purple', gradient: 'from-[#33106A] via-[#46178F] to-[#250850]', isDark: true },
  { id: 'spring', name: 'Spring Blossom', gradient: 'from-[#ffccd5] via-[#cbf3f0] to-[#2ec4b6]', isDark: false },
  { id: 'summer', name: 'Summer Beach', gradient: 'from-[#00b4d8] via-[#90e0ef] to-[#ffb703]', isDark: false },
  { id: 'autumn', name: 'Autumn Foliage', gradient: 'from-[#d97706] via-[#b45309] to-[#78350f]', isDark: true },
  { id: 'winter', name: 'Winter Frost', gradient: 'from-[#03045e] via-[#0077b6] to-[#90e0ef]', isDark: true },
  { id: 'dark', name: 'Dark Mode', gradient: 'from-[#0f172a] via-[#1e1b4b] to-[#09090b]', isDark: true },
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
