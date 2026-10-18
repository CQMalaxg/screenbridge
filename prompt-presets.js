'use strict';

// Built-in prompt presets are intentionally provider/model agnostic. They are
// copied into the user's config on first run, so every preset remains editable
// and can be removed without changing the application code.
const DEFAULT_PROMPT_PRESETS = {
  vision: [
    {
      id: 'vision-prompt-general',
      name: '通用：先结论后解释',
      text: '请阅读截图中的全部内容，先直接给出结论或最终答案，再用简洁条目解释依据。不要臆测截图中没有的信息；如果题目、代码或选项不完整，请先指出缺失部分并说明需要补充什么。'
    },
    {
      id: 'vision-prompt-code-solution',
      name: '编程题：思路、代码与复杂度',
      text: '请把截图中的编程题整理为：1. 题意与输入输出；2. 解题思路；3. 可直接运行的完整代码；4. 时间复杂度和空间复杂度；5. 用一个小例子手动验证。优先给出正确、清晰、符合题目语言要求的解法。'
    },
    {
      id: 'vision-prompt-code-error',
      name: '代码报错：定位根因并修复',
      text: '请检查截图中的代码、报错信息和运行环境。先准确指出报错发生的位置，再解释根本原因，给出最小修改方案和修复后的完整关键代码。请区分语法错误、类型/空值错误、边界错误、运行时错误和环境配置错误；不要只给表面绕过方案。'
    },
    {
      id: 'vision-prompt-complexity',
      name: '复杂度审查：降到题目要求',
      text: '请审查截图中的算法是否满足题目要求的时间复杂度和空间复杂度。先写出当前方案的复杂度及其推导，指出超时或内存超限的具体瓶颈，再给出达到要求的优化思路、完整代码和优化后的复杂度。若题目没有明确要求，请根据数据范围推断可接受复杂度并说明依据。'
    },
    {
      id: 'vision-prompt-failed-tests',
      name: '用例未通过：复现与修复',
      text: '请分析截图中未通过的测试用例、期望结果、实际结果和代码。先找出最小失败样例，说明代码在哪一步产生了错误，再给出修复后的代码。额外补充至少 3 个能覆盖该缺陷的测试用例，并说明修复不会破坏哪些已有情况。'
    },
    {
      id: 'vision-prompt-edge-cases',
      name: '边界条件：反例与健壮性',
      text: '请从空输入、单个元素、重复值、负数、极大/极小值、已排序/逆序、溢出、重复调用和非法输入等方面检查截图中的方案。列出可能失败的边界情况，给出具体反例，并在必要时修改代码使其健壮。'
    },
    {
      id: 'vision-prompt-review',
      name: '严格代码审查：正确性优先',
      text: '请像严格的代码评审者一样检查截图内容。按“阻塞性正确性问题、潜在运行时问题、复杂度问题、可读性问题”的顺序输出；每个问题都标明位置、影响、原因和修改建议。确认没有高风险问题后，再给出简洁的改进版代码或伪代码。'
    },
    {
      id: 'vision-prompt-multi-question',
      name: '多题截图：逐题回答',
      text: '截图中可能包含多个题目或多个小问，请按题号/小问逐项回答，不要遗漏。每项使用“结论、关键依据、代码或步骤、复杂度/注意事项”的结构；无法辨认的文字请标记为不确定，不要自行补全。'
    },
    {
      id: 'vision-prompt-interview',
      name: '面试现场：简洁可复述',
      text: '请生成适合面试现场直接复述的回答：先用一句话说结论，再用 3 到 5 点说明思路、正确性和复杂度。若需要代码，给出关键实现并解释关键决策；同时列出面试官最可能继续追问的一个问题及回答。'
    },
    {
      id: 'vision-prompt-final-only',
      name: '只要最终答案',
      text: '请只输出可以直接提交或复制使用的最终答案。编程题给出完整代码，必要时在代码后用两三句话补充复杂度。不要重复题目，不要输出分析过程，不确定时明确标注无法从截图确认的部分。'
    }
  ],
  chat: [
    {
      id: 'chat-prompt-explain',
      name: '继续解释上一步',
      text: '请基于当前截图和上一轮回答继续解释这个问题。先直接回答我的追问，再用一个小例子说明；如果上一轮回答有错误，请明确指出并更正，不要默认它一定正确。'
    },
    {
      id: 'chat-prompt-fix-error',
      name: '追问：修复代码报错',
      text: '请定位我指出的代码报错：说明触发条件、根本原因、最小修复和修复后的完整关键代码。请检查是否还存在同类错误，并给出一个能验证修复成功的测试用例。'
    },
    {
      id: 'chat-prompt-optimize',
      name: '追问：降低时间复杂度',
      text: '请重新审查上一版解法的时间和空间复杂度。指出最耗时的操作，判断是否满足数据范围要求，并给出更优解法的核心推导、代码修改和新复杂度。若无法再优化，请证明原因。'
    },
    {
      id: 'chat-prompt-failed-case',
      name: '追问：分析失败用例',
      text: '请针对这个未通过的用例逐步模拟程序执行，找出第一个错误状态。给出最小反例、修复方案和至少两个相邻边界用例，确保修复覆盖根因而不是只针对当前样例。'
    },
    {
      id: 'chat-prompt-counterexample',
      name: '追问：寻找反例',
      text: '请尝试证明上一版思路是否始终正确。如果不正确，请构造最小反例并解释为什么会失败；如果正确，请给出简短的不变量或证明。最后说明代码是否需要调整。'
    },
    {
      id: 'chat-prompt-edge-review',
      name: '追问：补齐边界条件',
      text: '请继续检查上一版答案遗漏的边界条件，包括空值、极端规模、重复数据、溢出、输入格式和异常流程。按“问题—影响—修复”列出，并给出必要的代码改动。'
    },
    {
      id: 'chat-prompt-runnable',
      name: '追问：给可运行版本',
      text: '请把上一版回答整理成可直接复制运行的完整版本，补齐导入、函数签名、输入输出和必要的错误处理。不要省略会影响运行的代码；随后用一个示例说明输出。'
    },
    {
      id: 'chat-prompt-interviewer',
      name: '追问：模拟面试官',
      text: '请以面试官视角继续追问一个最关键的问题，并紧接着给出优秀候选人的示范回答。重点考察正确性证明、复杂度、边界条件和方案取舍，回答要简洁、可复述。'
    }
  ]
};

function getDefaultPromptPresets(kind) {
  return (DEFAULT_PROMPT_PRESETS[kind] || []).map((preset) => ({ ...preset }));
}

module.exports = { DEFAULT_PROMPT_PRESETS, getDefaultPromptPresets };
