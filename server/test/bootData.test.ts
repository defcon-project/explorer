import { renderBootData } from '../src/utils/bootData';

it('serializes preload data without allowing a closing script tag to inject markup', () => {
  const value = { stats: { label: '</script><script>alert(1)</script>', height: 123 } };
  const html = renderBootData(value);
  expect(html.match(/<script/g)).toHaveLength(1);
  expect(html).toContain('type="application/json"');
  const json = html.slice(html.indexOf('>') + 1, html.lastIndexOf('</script>'));
  expect(json).not.toContain('<');
  expect(JSON.parse(json)).toEqual(value);
});
