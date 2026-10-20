/** @type {import('@storybook/html-vite').Preview} */
const preview = {
  parameters: {
    backgrounds: { options: { dark: { name: 'dark', value: '#1b1e23' }, light: { name: 'light', value: '#f4f5f7' } } },
    controls: { expanded: true },
    a11y: { test: 'todo' },
    options: { storySort: { order: ['Introduction', 'API', 'Timeline', ['Reference', 'Navigation', 'Selection', 'Editing', 'Themes', 'Performance']] } },
  },
  initialGlobals: { backgrounds: { value: 'dark' } },
};
export default preview;
