import type { ChapterFormula, FeaturedFormula, FormulaDependency, FormulaLearningCopyEntry, FormulaPrerequisite, SearchFormula } from '../types/formula';

export interface FormulaBrief {
  id: string;
  number: string;
  title: string;
  chapter?: string | number;
  section?: string;
  latex: string;
  shortContext: string;
  longContext: string;
  keySymbols: string[];
  prerequisiteCount: number;
  formulaPrerequisiteCount: number;
  variablePrerequisiteCount: number;
}

export interface FormulaLearningCopy {
  plainMeaning: string;
  inThisChapter: string;
}

export function formulaNumber(formulaId: string): string {
  return formulaId.replace(/^formula_/, '');
}

export function compactContext(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) return '这条公式暂时没有可用的教材上下文。';
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength).replace(/\s+\S*$/, '')}…`;
}

interface BuildFormulaLearningCopyInput {
  formulaId?: string;
  language?: 'en' | 'zh';
  cache?: Record<string, FormulaLearningCopyEntry>;
  context?: string;
  latex?: string;
  chapterTitle?: string;
  formulaLabel?: string;
  formulaNumber?: string;
  section?: string;
}

function formulaDisplayName(input: BuildFormulaLearningCopyInput): string {
  return input.formulaLabel?.trim() || (input.formulaNumber ? `Formula ${input.formulaNumber}` : '这条公式');
}

function formulaLocation(input: BuildFormulaLearningCopyInput): string {
  return input.chapterTitle?.trim() || input.section?.trim() || '当前教材片段';
}

function normalizeLatex(value = ''): string {
  return value.replace(/\s+/g, '');
}

function cleanContext(value = ''): string {
  return value
    .replace(/\$\$[\s\S]*?\$\$/g, ' ')
    .replace(/\$([^$]+)\$/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function contextExcerpt(value = '', maxLength = 150): string {
  const cleaned = cleanContext(value);
  if (!cleaned) return '';
  if (cleaned.length <= maxLength) return cleaned;
  return `${cleaned.slice(0, maxLength).replace(/\s+\S*$/, '')}...`;
}

function inferFormulaCopy(input: BuildFormulaLearningCopyInput, label: string, chapterText: string): FormulaLearningCopy {
  const latex = normalizeLatex(input.latex);
  const context = input.context || '';
  const lowerContext = context.toLowerCase();

  if (/P_\{?ij\}?=\\binom/.test(latex) || (latex.includes('P_{ij}') && lowerContext.includes('wright-fisher'))) {
    return {
      plainMeaning: `${label} 给出 Wright-Fisher 模型的一步转移概率：当前有 i 个 B 拷贝时，下一代恰好出现 j 个 B 拷贝的概率。它把“抽取 2N 个配子”写成一个二项分布。`,
      inThisChapter: `在 ${chapterText} 中，它是后续转移矩阵和漂变推导的入口；先理解 P_ij、i、j 和 2N，后面读等位基因频率变化会顺很多。`,
    };
  }

  if (/R=\\sigma_\{?A\}?\^\{?2\}?\\beta/.test(latex) || (latex.includes('\\sigma_{A}^{2}') && latex.includes('\\beta'))) {
    return {
      plainMeaning: `${label} 把选择响应 R 写成加性遗传方差 sigma_A^2 与选择梯度 beta 的乘积。它强调：选择能推动多少变化，既取决于可遗传变异有多少，也取决于性状和适合度之间的关联强度。`,
      inThisChapter: `在 ${chapterText} 中，它把育种者方程从 R = h^2 S 改写到 Robertson-Price / Lande 方程的语言里，为后面多性状响应和 G beta 形式做铺垫。`,
    };
  }

  if (/E\(\\overline\{z\}_\{?t\}?\)=\\mu\+E\(g_\{?t\}?\)\+b_\{?t\}?/.test(latex)) {
    return {
      plainMeaning: `${label} 把第 t 代样本均值的期望拆成三部分：基准均值 mu、遗传偏离的期望 E(g_t)，以及环境偏离 b_t。它是在问短期响应里“均值变了多少”来自哪里。`,
      inThisChapter: `在 ${chapterText} 中，它把漂变和选择造成的遗传变化同环境偏差分开，方便后面继续讨论短期响应的方差。`,
    };
  }

  if (/R=h\^\{?2\}?S/.test(latex)) {
    return {
      plainMeaning: `${label} 是育种者方程：选择响应 R 等于狭义遗传力 h^2 乘以选择差 S。它把“被选择的亲本有多不同”和“这种差异有多少可遗传”合在一起预测下一代均值变化。`,
      inThisChapter: `在 ${chapterText} 中，它是连接遗传力、选择差和响应预测的核心公式，后面的方差形式和多性状形式都会回到这个思想。`,
    };
  }

  if (latex.includes('\\pi') && latex.includes('D') && lowerContext.includes('divergence')) {
    return {
      plainMeaning: `${label} 同时写出中性模型下的多态性 pi_i 和群体间分化 D_i。两者都含有突变率 mu_i，因此可以用它们的比例比较不同基因座是否符合中性预期。`,
      inThisChapter: `在 ${chapterText} 中，它为基于分化的中性检验建立基准关系；先看清 pi、D、N_e 和 t 的角色，再读后面的比值会更直接。`,
    };
  }

  if (/\\overline\{z\}=\\sum/.test(latex)) {
    return {
      plainMeaning: `${label} 把总体平均性状值写成各类别频率 q_i 与类别性状值 z_i 的加权和。也就是说，平均值会随着类别频率或类别性状值的变化而变化。`,
      inThisChapter: `在 ${chapterText} 中，它给 Price 方程后续分解提供起点：先把平均值写清楚，后面才能追踪选择如何改变这个平均。`,
    };
  }

  const excerpt = contextExcerpt(context);
  return {
    plainMeaning: excerpt
      ? `${label} 可以先按附近教材语境来读：${excerpt}`
      : `${label} 需要结合所在章节的定义来读。先辨认等号两侧的量，再沿图谱查看它依赖的符号和前置公式。`,
    inThisChapter: `在 ${chapterText} 中，它是一个学习检查点：确认每个符号的含义，再看它如何支撑本节的推导。`,
  };
}

export function buildFormulaLearningCopy(input: BuildFormulaLearningCopyInput): FormulaLearningCopy {
  const language = input.language || 'zh';
  const cached = input.formulaId ? input.cache?.[input.formulaId]?.[language] : undefined;
  if (cached?.plainMeaning && cached?.inThisChapter) return cached;

  const label = formulaDisplayName(input);
  const location = formulaLocation(input);
  const section = input.section?.trim();

  if (language === 'zh') {
    const chapterText = section ? `${location} 的「${section}」部分` : location;
    return inferFormulaCopy(input, label, chapterText);
  }

  return {
    plainMeaning: `${label} is a mathematical relationship used in ${location}. Read it by identifying the variables first, then following the graph to see which earlier definitions support it.`,
    inThisChapter: section
      ? `In ${location}, this formula is a study checkpoint for the ${section} section: understand its symbols, inspect its prerequisites, and connect it back to the chapter argument.`
      : `In ${location}, this formula is a study checkpoint: understand its symbols, inspect its prerequisites, and connect it back to the chapter argument.`,
  };
}

export function standaloneGraphCopy(): string {
  return '这个公式目前在本地图谱中没有已确认的前置或后续关系。';
}

function cleanVariableText(value?: string): string {
  return (value || '')
    .replace(/\s+/g, ' ')
    .replace(/\$\s*([^$]+?)\s*\$/g, '$1')
    .replace(/^line and\s+/i, '')
    .trim();
}

export function humanizeSource(value?: string): string {
  const source = (value || 'context').replace(/_/g, ' ').toLowerCase();
  if (source === 'nearby text') return '本地上下文';
  if (source === 'text excerpt') return '教材摘录';
  return source;
}

export function explainVariablePrerequisite(prereq: FormulaPrerequisite): string {
  const symbol = prereq.symbol || '这个符号';
  const excerpt = cleanVariableText(prereq.source_excerpt);
  const meaning = cleanVariableText(prereq.meaning);
  const definition = cleanVariableText(prereq.definition);

  if (meaning && !/^local variable used near/i.test(meaning)) return meaning;
  if (definition && !/^local variable used near/i.test(definition)) return definition;
  if (excerpt) return excerpt;
  return `${symbol}: 在教材当前上下文中定义。`;
}

function cleanSymbolForText(symbol: string): string {
  return symbol
    .replace(/\\/g, '')
    .replace(/[{}]/g, '')
    .trim();
}

export function describeFormulaSymbol(symbol: string, formula?: Pick<ChapterFormula, 'id' | 'latex' | 'context_text'>): string {
  const latex = normalizeLatex(formula?.latex);
  const plainSymbol = cleanSymbolForText(symbol);

  if (formula?.id === 'formula_7.1') {
    if (symbol === 'p') return 'p 表示选择发生前的等位基因 a 频率，是本式追踪频率变化的起点。';
    if (symbol === 'p^{\\prime}' || symbol === "p'") return "p' 表示经过一代 viability selection 之后，等位基因 a 的新频率。";
    if (symbol === 'W_{\\mathrm{a}}' || symbol === 'W_a') return 'W_a 表示等位基因 a 的边际适合度，决定选择会把 a 的频率推高还是压低。';
    if (symbol === '\\overline{W}') return 'W 的横线表示群体平均适合度；本式用 W_a 与平均适合度的比值来缩放频率 p。';
  }

  if (symbol === 'P_{ij}') return '在本式中，P_ij 表示从当前 i 个 B 拷贝转移到下一代 j 个 B 拷贝的概率，是 Wright-Fisher 转移矩阵里的一个元素。';
  if (symbol === 'i') return 'i 表示当前这一代中 B 等位基因的拷贝数，公式用它来给每次抽样的成功概率 i/(2N) 定值。';
  if (symbol === 'j') return 'j 表示下一代中 B 等位基因的拷贝数，也就是这个二项分布正在计算的结果。';
  if (symbol === 'N') return 'N 是群体大小参数；在二倍体 Wright-Fisher 模型里，2N 表示下一代抽样的基因拷贝数。';
  if (symbol === 'R') return 'R 表示选择响应，也就是经过一代选择后性状均值预期改变的量。';
  if (symbol === '\\sigma_{A}^{2}' || symbol === '\\sigma_A^2') return 'sigma_A^2 是加性遗传方差，表示能被选择转化为后代响应的可遗传变异。';
  if (symbol === '\\beta') return 'beta 是选择梯度或性状值与适合度之间的关联强度，决定选择沿哪个方向、以多大强度推动响应。';
  if (symbol === 'h^2' || symbol === 'h^{2}') return 'h^2 是狭义遗传力，表示表型差异中有多少可以通过加性遗传效应传给下一代。';
  if (symbol === 'S') return 'S 是选择差，表示被选亲本的平均性状值相对选择前群体均值偏离多少。';
  if (symbol === '\\overline{z}_{t}') return 'z_t 的横线表示第 t 代样本平均性状值；本式关心这个平均值在漂变、选择和环境偏差下的期望。';
  if (symbol === '\\mu') return 'mu 表示基准群体均值，是本式拆分第 t 代平均值时的参照点。';
  if (symbol === 'g_{t}') return 'g_t 表示第 t 代遗传偏离；在漂变下它的期望为 0，在选择下会由育种者方程累积。';
  if (symbol === 'b_{t}') return 'b_t 表示第 t 代的平均环境偏离，用来把环境造成的均值变化同遗传变化分开。';
  if (symbol === '\\pi_i') return 'pi_i 表示第 i 个基因座的核苷酸多样性，用来衡量群体内多态性。';
  if (symbol === 'D_i') return 'D_i 表示第 i 个基因座的群体间分化量，用来和多态性一起构成中性检验的比较基准。';
  if (symbol === 'N_e') return 'N_e 是有效群体大小，决定中性模型下多态性水平的尺度。';
  if (symbol === '\\mu_i') return 'mu_i 表示第 i 个基因座的突变率，它同时影响多态性和分化。';

  const excerpt = contextExcerpt(formula?.context_text, 120);
  if (latex && latex.includes(normalizeLatex(symbol))) {
    return excerpt
      ? `${plainSymbol} 是这个公式直接使用的符号。先结合附近文字读它的定义：${excerpt}`
      : `${plainSymbol} 是这个公式直接使用的符号；需要结合本节文字确认它在当前模型中的含义。`;
  }
  return excerpt
    ? `${plainSymbol} 出现在当前公式附近的教材语境中，可以先按这段话定位它的含义：${excerpt}`
    : `${plainSymbol} 是当前公式需要辨认的符号；建议沿图谱查看它的定义或前置公式。`;
}

export function buildFormulaSymbolPrerequisites(formula?: ChapterFormula): FormulaPrerequisite[] {
  if (!formula) return [];
  const symbols = new Set<string>();
  if (formula.id === 'formula_7.1') {
    ['p', 'p^{\\prime}', 'W_{\\mathrm{a}}', '\\overline{W}'].forEach((symbol) => symbols.add(symbol));
  } else {
    formula.symbols_defined?.forEach((symbol) => symbols.add(symbol));
    formula.symbols_used?.forEach((symbol) => symbols.add(symbol));
  }

  return [...symbols]
    .filter(Boolean)
    .slice(0, 8)
    .map((symbol) => {
      const meaning = describeFormulaSymbol(symbol, formula);
      return {
        type: 'variable_definition' as const,
        symbol,
        meaning,
        definition: meaning,
        source: 'formula_symbols',
        source_excerpt: formula.context_text,
        confidence: formula.symbols_defined?.includes(symbol) ? 0.88 : 0.74,
        edge_status: 'accepted' as const,
      };
    });
}

export function extractKeySymbols(formula?: ChapterFormula, prerequisites: FormulaPrerequisite[] = []): string[] {
  const symbols = new Set<string>();
  formula?.symbols_defined?.forEach((symbol) => symbols.add(symbol));
  formula?.symbols_used?.slice(0, 8).forEach((symbol) => symbols.add(symbol));
  prerequisites.forEach((prereq) => {
    if (prereq.via_symbol) symbols.add(prereq.via_symbol);
    if (prereq.symbol) symbols.add(prereq.symbol);
  });
  return [...symbols].filter(Boolean).slice(0, 8);
}

export function buildFormulaBrief(input: {
  id: string;
  featured?: FeaturedFormula;
  search?: SearchFormula;
  chapterFormula?: ChapterFormula;
  dependency?: FormulaDependency | null;
}): FormulaBrief {
  const prerequisites = input.dependency?.prerequisites || [];
  const context = input.search?.context || input.chapterFormula?.context_text || '';

  return {
    id: input.id,
    number: formulaNumber(input.id),
    title: input.search?.label || input.featured?.display_name || input.featured?.label || input.chapterFormula?.label || formulaNumber(input.id),
    chapter: input.search?.chapter || input.featured?.chapter,
    section: input.search?.section || input.chapterFormula?.section,
    latex: input.chapterFormula?.latex || input.search?.latex_preview || input.featured?.latex_preview || '',
    shortContext: compactContext(context, 140),
    longContext: compactContext(context, 420),
    keySymbols: extractKeySymbols(input.chapterFormula, prerequisites),
    prerequisiteCount: prerequisites.length,
    formulaPrerequisiteCount: prerequisites.filter((item) => item.type === 'formula').length,
    variablePrerequisiteCount: prerequisites.filter((item) => item.type === 'variable_definition').length,
  };
}

export function explainPrerequisite(prereq: FormulaPrerequisite): string {
  if (prereq.type === 'formula') {
    const via = prereq.via_symbol ? `，连接符号是 ${prereq.via_symbol}` : '';
    const scope = prereq.cross_chapter ? '，它来自其他章节' : '';
    return `这条前置公式支撑了当前公式${via}${scope}。`;
  }

  const symbol = prereq.symbol || '这个符号';
  const definition = explainVariablePrerequisite(prereq);
  return `${symbol} 在这里很关键，因为当前公式依赖它的含义：${definition}`;
}
