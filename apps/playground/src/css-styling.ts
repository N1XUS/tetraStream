import type { Completion, Snapshot } from 'tetra-stream';

export const cssVisualProperties = [
  'background', 'background-color', 'color', 'padding', 'border-radius',
  'border', 'box-shadow', 'font-size', 'font-weight', 'letter-spacing', 'line-height',
] as const;
export type CssVisualProperty = typeof cssVisualProperties[number];
export type CssPreviewStyle = Partial<Record<CssVisualProperty, string>>;
export interface PreviewDeclaration {
  id: string;
  selector: string;
  property: string;
  value: string;
  status: Completion | 'pending';
  applied: boolean;
  reason: string;
}
export interface CssPreview {
  style: CssPreviewStyle;
  declarations: PreviewDeclaration[];
  complete: number;
  partial: number;
  applied: number;
}
export type SupportsCssValue = (property: string, value: string) => boolean;

export const cssStylingExample = `.ai-card {
  background: linear-gradient(135deg, #fff6e5, #eee5ff);
  color: #382b59;
  padding: 32px;
  border-radius: 24px;
  border: 1px solid #d6c5ee;
  box-shadow: 0 18px 48px rgba(81, 53, 123, 0.16);
  font-size: 17px;
  line-height: 1.65;
  letter-spacing: -0.2px;
}
`;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function isVisualProperty(property: string): property is CssVisualProperty {
  return cssVisualProperties.some(allowed => allowed === property);
}

/** Conservative preview policy: no resources, variables, escapes, or CSS injection. */
function isLocalVisualValue(value: string): boolean {
  if (!value || /[\\"'{};@]/.test(value)) return false;
  const functions = Array.from(value.matchAll(/([a-z-]+)\s*\(/gi), match => match[1].toLowerCase());
  const allowed = ['linear-gradient', 'radial-gradient', 'rgb', 'rgba', 'hsl', 'hsla', 'oklch', 'oklab', 'color', 'color-mix', 'lab', 'lch'];
  return functions.every(name => allowed.includes(name));
}

/**
 * Project direct declarations in top-level .ai-card rules. Only closed, supported
 * values become inline properties on the single preview element; source selectors
 * are never inserted into a stylesheet. Recompute from each snapshot for rewinds.
 */
export function readCssPreview(snapshot: Snapshot<unknown>, supports: SupportsCssValue): CssPreview {
  const style: CssPreviewStyle = {};
  const declarations: PreviewDeclaration[] = [];
  if (snapshot.format !== 'css' || !isRecord(snapshot.data) || snapshot.data.kind !== 'stylesheet' || !Array.isArray(snapshot.data.nodes)) {
    return { style, declarations, complete: 0, partial: 0, applied: 0 };
  }
  snapshot.data.nodes.forEach((rule: unknown, ruleIndex: number) => {
    if (!isRecord(rule) || rule.kind !== 'rule' || !Array.isArray(rule.nodes)) return;
    const selector = typeof rule.selector === 'string' ? rule.selector.trim() : '';
    const targetComplete = snapshot.status[`/nodes/${ruleIndex}/selector`] === 'complete';
    rule.nodes.forEach((node: unknown, index: number) => {
      if (!isRecord(node) || node.kind !== 'declaration') return;
      const property = typeof node.property === 'string' ? node.property.toLowerCase().trim() : '';
      const value = typeof node.value === 'string' ? node.value.trim() : '';
      const id = `/nodes/${ruleIndex}/nodes/${index}`;
      const valueStatus = snapshot.status[`${id}/value`];
      const nodeStatus = snapshot.status[id];
      const status = nodeStatus === 'complete' && valueStatus === 'complete' ? 'complete' : valueStatus || nodeStatus ? 'partial' : 'pending';
      const complete = nodeStatus === 'complete' && valueStatus === 'complete';
      const reason = !complete ? 'Still arriving' : selector !== '.ai-card' || !targetComplete ? 'Outside preview target' : node.important === true ? '!important not enabled' : !isVisualProperty(property) ? 'Property not enabled' : !isLocalVisualValue(value) || !supports(property, value) ? 'Value not supported' : 'Applied';
      const applied = reason === 'Applied';
      if (applied && isVisualProperty(property)) style[property] = value;
      declarations.push({ id, selector, property, value, status, applied, reason });
    });
  });
  return {
    style,
    declarations,
    complete: declarations.filter(item => item.status === 'complete').length,
    partial: declarations.filter(item => item.status !== 'complete').length,
    applied: declarations.filter(item => item.applied).length,
  };
}
