import type { FormulaPrerequisite } from '../../types/formula';
import { explainPrerequisite } from '../../utils/formulaInfo';

interface DependencyExplanationProps {
  prerequisite: FormulaPrerequisite;
}

export function DependencyExplanation({ prerequisite }: DependencyExplanationProps) {
  return <p className="dependency-explanation">{explainPrerequisite(prerequisite)}</p>;
}
