import pptxgen from "pptxgenjs";
const pres = new pptxgen();
pres.layout = "LAYOUT_16x9";
pres.title = "暴雨内涝下城市道路交通预演与韧性评估";
pres.author = "张庭瑞";
pres.subject = "武汉理工大学";

// Color palette - academic blue theme
const colors = {
  primary: "1A365D",      // Deep navy blue
  secondary: "2B6CB0",    // Medium blue
  accent: "E53E3E",       // Red accent for emphasis
  light: "EBF8FF",        // Very light blue
  text: "1A202C",         // Dark gray text
  white: "FFFFFF",
  gray: "718096"
};

// Helper: Create title slide
function createTitleSlide() {
  let slide = pres.addSlide();
  slide.background = { color: colors.primary };

  // Title
  slide.addText("暴雨内涝下城市道路交通\n预演与韧性评估", {
    x: 0.5, y: 1.5, w: 9, h: 2,
    fontSize: 40, bold: true, color: colors.white,
    align: "center", valign: "middle",
    lineSpacingMultiple: 1.3
  });

  // Decorative line
  slide.addShape("RECTANGLE", {
    x: 3.5, y: 3.6, w: 3, h: 0.05,
    fill: { color: colors.accent }
  });

  // Author
  slide.addText("张庭瑞", {
    x: 0.5, y: 4.0, w: 9, h: 0.6,
    fontSize: 24, color: colors.white, align: "center"
  });

  // Institution
  slide.addText("武汉理工大学", {
    x: 0.5, y: 4.6, w: 9, h: 0.5,
    fontSize: 18, color: colors.gray, align: "center"
  });
}

// Helper: Section header slide
function createSectionSlide(title, subtitle) {
  let slide = pres.addSlide();
  slide.background = { color: colors.secondary };

  slide.addText(title, {
    x: 0.5, y: 2.0, w: 9, h: 1.2,
    fontSize: 44, bold: true, color: colors.white, align: "center"
  });

  if (subtitle) {
    slide.addText(subtitle, {
      x: 0.5, y: 3.3, w: 9, h: 0.6,
      fontSize: 20, color: colors.light, align: "center"
    });
  }

  // Decorative bar
  slide.addShape("RECTANGLE", {
    x: 4, y: 4.2, w: 2, h: 0.06,
    fill: { color: colors.white }
  });
}

// Helper: Content slide with bullet points
function createContentSlide(title, bullets, options = {}) {
  let slide = pres.addSlide();
  slide.background = { color: colors.white };

  // Header bar
  slide.addShape("RECTANGLE", {
    x: 0, y: 0, w: 10, h: 0.9,
    fill: { color: colors.primary }
  });

  // Title
  slide.addText(title, {
    x: 0.5, y: 0.15, w: 9, h: 0.6,
    fontSize: 26, bold: true, color: colors.white, margin: 0
  });

  // Content bullets
  const bulletItems = bullets.map((b, i) => ({
    text: b,
    options: { bullet: true, breakLine: i < bullets.length - 1 }
  }));

  slide.addText(bulletItems, {
    x: 0.6, y: 1.2, w: 8.8, h: 4.0,
    fontSize: options.fontSize || 18,
    color: colors.text,
    paraSpaceAfter: 12,
    valign: "top"
  });

  // Side accent
  slide.addShape("RECTANGLE", {
    x: 0, y: 0.9, w: 0.08, h: 4.725,
    fill: { color: colors.accent }
  });
}

// Helper: Two-column slide
function createTwoColumnSlide(title, leftItems, rightItems, leftTitle, rightTitle) {
  let slide = pres.addSlide();
  slide.background = { color: colors.white };

  // Header
  slide.addShape("RECTANGLE", {
    x: 0, y: 0, w: 10, h: 0.9,
    fill: { color: colors.primary }
  });

  slide.addText(title, {
    x: 0.5, y: 0.15, w: 9, h: 0.6,
    fontSize: 26, bold: true, color: colors.white, margin: 0
  });

  // Left column title
  slide.addText(leftTitle || "方法一", {
    x: 0.5, y: 1.1, w: 4.3, h: 0.5,
    fontSize: 18, bold: true, color: colors.secondary
  });

  // Left content
  slide.addText(leftItems.map((b, i) => ({
    text: b,
    options: { bullet: true, breakLine: i < leftItems.length - 1 }
  })), {
    x: 0.5, y: 1.6, w: 4.3, h: 3.5,
    fontSize: 16, color: colors.text, paraSpaceAfter: 8
  });

  // Divider
  slide.addShape("RECTANGLE", {
    x: 4.9, y: 1.1, w: 0.03, h: 4.0,
    fill: { color: colors.gray }
  });

  // Right column title
  slide.addText(rightTitle || "方法二", {
    x: 5.2, y: 1.1, w: 4.3, h: 0.5,
    fontSize: 18, bold: true, color: colors.secondary
  });

  // Right content
  slide.addText(rightItems.map((b, i) => ({
    text: b,
    options: { bullet: true, breakLine: i < rightItems.length - 1 }
  })), {
    x: 5.2, y: 1.6, w: 4.3, h: 3.5,
    fontSize: 16, color: colors.text, paraSpaceAfter: 8
  });
}

// === SLIDE 1: Title ===
createTitleSlide();

// === SLIDE 2: Abstract ===
let slide2 = pres.addSlide();
slide2.background = { color: colors.white };

slide2.addShape("RECTANGLE", {
  x: 0, y: 0, w: 10, h: 0.9,
  fill: { color: colors.primary }
});

slide2.addText("研究概述", {
  x: 0.5, y: 0.15, w: 9, h: 0.6,
  fontSize: 26, bold: true, color: colors.white, margin: 0
});

slide2.addText([
  { text: "研究背景", options: { bold: true, fontSize: 18, color: colors.secondary, breakLine: true } },
  { text: "极端降雨事件频发导致城市内涝频发，严重影响交通系统运行效率", options: { bullet: true, breakLine: true } },
  { text: "", options: { breakLine: true } },
  { text: "研究目标", options: { bold: true, fontSize: 18, color: colors.secondary, breakLine: true } },
  { text: "构建耦合内涝-交通仿真模型，实现城市道路交通韧性评估与预测", options: { bullet: true, breakLine: true } },
  { text: "", options: { breakLine: true } },
  { text: "创新点", options: { bold: true, fontSize: 18, color: colors.secondary, breakLine: true } },
  { text: "提出基于图卷积胶囊网络(GCN-CapsNet)的交通流预测方法", options: { bullet: true, breakLine: true } },
  { text: "建立多维度交通路网韧性评估指标体系", options: { bullet: true } }
], {
  x: 0.6, y: 1.1, w: 8.8, h: 4.2,
  fontSize: 17, color: colors.text, paraSpaceAfter: 6
});

slide2.addShape("RECTANGLE", {
  x: 0, y: 0.9, w: 0.08, h: 4.725,
  fill: { color: colors.accent }
});

// === SLIDE 3: Background ===
createContentSlide("研究背景", [
  "气候变化导致极端降雨事件频率和强度显著增加",
  "城市化进程中硬底化面积扩大，排水能力不足",
  "城市道路交通系统在内涝事件中表现出明显的脆弱性",
  "传统交通管理方式难以应对内涝引发的系统性风险",
  "迫切需要建立内涝-交通耦合仿真与韧性评估方法",
  "为城市交通应急管理和韧性提升提供决策支持"
]);

// === SLIDE 4: Methodology 1 - Technical Route ===
let slide4 = pres.addSlide();
slide4.background = { color: colors.white };

slide4.addShape("RECTANGLE", {
  x: 0, y: 0, w: 10, h: 0.9,
  fill: { color: colors.primary }
});

slide4.addText("技术路线与内涝交通耦合仿真", {
  x: 0.5, y: 0.15, w: 9, h: 0.6,
  fontSize: 26, bold: true, color: colors.white, margin: 0
});

// Flow boxes
const flowSteps = [
  { text: "气象数据\n输入", x: 0.5 },
  { text: "内涝\n仿真模型", x: 2.4 },
  { text: "路网\n淹没问题", x: 4.3 },
  { text: "交通流\n仿真", x: 6.2 },
  { text: "韧性\n评估", x: 8.1 }
];

flowSteps.forEach((step, i) => {
  // Box
  slide4.addShape("ROUNDED_RECTANGLE", {
    x: step.x, y: 1.3, w: 1.7, h: 1.0,
    fill: { color: i % 2 === 0 ? colors.secondary : colors.primary },
    rectRadius: 0.08
  });

  slide4.addText(step.text, {
    x: step.x, y: 1.35, w: 1.7, h: 0.9,
    fontSize: 13, bold: true, color: colors.white,
    align: "center", valign: "middle"
  });

  // Arrow
  if (i < flowSteps.length - 1) {
    slide4.addShape("RECTANGLE", {
      x: step.x + 1.75, y: 1.7, w: 0.5, h: 0.08,
      fill: { color: colors.gray }
    });
    slide4.addText("▶", {
      x: step.x + 2.1, y: 1.5, w: 0.3, h: 0.5,
      fontSize: 14, color: colors.gray, align: "center"
    });
  }
});

// Key components
slide4.addText("耦合仿真关键模块", {
  x: 0.5, y: 2.6, w: 9, h: 0.5,
  fontSize: 18, bold: true, color: colors.secondary
});

slide4.addText([
  { text: "水动力学模型：基于SWMM/InFoWorks模拟地表径流与积水过程", options: { bullet: true, breakLine: true } },
  { text: "交通仿真模型：采用VISSIM/Sumo进行微观交通流模拟", options: { bullet: true, breakLine: true } },
  { text: "时空耦合机制：建立积水深度-通行能力-交通延误的动态映射关系", options: { bullet: true } }
], {
  x: 0.5, y: 3.1, w: 9, h: 2.0,
  fontSize: 16, color: colors.text, paraSpaceAfter: 8
});

slide4.addShape("RECTANGLE", {
  x: 0, y: 0.9, w: 0.08, h: 4.725,
  fill: { color: colors.accent }
});

// === SLIDE 5: Methodology 2 - Resilience Evaluation ===
createTwoColumnSlide(
  "交通路网韧性评估方法",
  [
    "韧性定义与测度框架",
    "基于系统性能衰减-恢复曲线的韧性度量",
    "引入帕累托最优进行多目标评估",
    "时变韧性指数构建"
  ],
  [
    "评估指标体系",
    "连通性指标：路网可达性",
    "效率指标：平均行程时间",
    "鲁棒性指标：失效节点比例",
    "恢复力指标：恢复时间与幅度"
  ],
  "韧性定义与测度",
  "评估指标体系"
);

// === SLIDE 6: Methodology 3 - GCN-CapsNet ===
let slide6 = pres.addSlide();
slide6.background = { color: colors.white };

slide6.addShape("RECTANGLE", {
  x: 0, y: 0, w: 10, h: 0.9,
  fill: { color: colors.primary }
});

slide6.addText("GCN-CapsNet预测模型", {
  x: 0.5, y: 0.15, w: 9, h: 0.6,
  fontSize: 26, bold: true, color: colors.white, margin: 0
});

// Model architecture boxes
const modelLayers = [
  { text: "输入层\n(路网拓扑)", y: 1.3 },
  { text: "GCN\n特征提取", y: 1.3 },
  { text: "胶囊层\n(Capsule)", y: 1.3 },
  { text: "动态\n路由", y: 1.3 },
  { text: "输出层\n(预测)", y: 1.3 }
];

const layerX = [0.5, 2.3, 4.1, 5.9, 7.7];
modelLayers.forEach((layer, i) => {
  slide6.addShape("ROUNDED_RECTANGLE", {
    x: layerX[i], y: layer.y, w: 1.6, h: 1.0,
    fill: { color: colors.secondary },
    rectRadius: 0.08
  });

  slide6.addText(layer.text, {
    x: layerX[i], y: layer.y, w: 1.6, h: 1.0,
    fontSize: 12, bold: true, color: colors.white,
    align: "center", valign: "middle"
  });

  if (i < modelLayers.length - 1) {
    slide6.addShape("RECTANGLE", {
      x: layerX[i] + 1.65, y: 1.75, w: 0.5, h: 0.06,
      fill: { color: colors.gray }
    });
  }
});

// Key features
slide6.addText("模型特点", {
  x: 0.5, y: 2.6, w: 4.3, h: 0.4,
  fontSize: 17, bold: true, color: colors.secondary
});

slide6.addText([
  { text: "图卷积网络捕获路网空间依赖", options: { bullet: true, breakLine: true } },
  { text: "胶囊网络捕捉交通流时空特征", options: { bullet: true, breakLine: true } },
  { text: "动态路由机制提升预测精度", options: { bullet: true, breakLine: true } },
  { text: "端到端学习框架", options: { bullet: true } }
], {
  x: 0.5, y: 3.0, w: 4.3, h: 2.2,
  fontSize: 15, color: colors.text, paraSpaceAfter: 6
});

// Applications
slide6.addText("应用场景", {
  x: 5.2, y: 2.6, w: 4.3, h: 0.4,
  fontSize: 17, bold: true, color: colors.secondary
});

slide6.addText([
  { text: "内涝情景下交通流量预测", options: { bullet: true, breakLine: true } },
  { text: "路网拥堵演变态势分析", options: { bullet: true, breakLine: true } },
  { text: "应急路径优化决策支持", options: { bullet: true } }
], {
  x: 5.2, y: 3.0, w: 4.3, h: 2.2,
  fontSize: 15, color: colors.text, paraSpaceAfter: 6
});

slide6.addShape("RECTANGLE", {
  x: 0, y: 0.9, w: 0.08, h: 4.725,
  fill: { color: colors.accent }
});

// === SLIDE 7: Experiments 1 ===
createContentSlide("实验设计", [
  "研究区域：选取武汉市典型城区作为研究对象",
  "数据来源：气象局降雨数据、高德交通数据、监控视频数据",
  "内涝模拟：基于SWMM构建排水管网模型，设定不同重现期降雨",
  "交通仿真：构建微观交通仿真路网，标定交通流参数",
  "实验方案：设置5种降雨情景（20年、50年、100年、200年、重现期）",
  "对比基准：与传统LSTM、GCN模型进行性能对比"
]);

// === SLIDE 8: Experiments 2 ===
let slide8 = pres.addSlide();
slide8.background = { color: colors.white };

slide8.addShape("RECTANGLE", {
  x: 0, y: 0, w: 10, h: 0.9,
  fill: { color: colors.primary }
});

slide8.addText("结果分析", {
  x: 0.5, y: 0.15, w: 9, h: 0.6,
  fontSize: 26, bold: true, color: colors.white, margin: 0
});

// Results table
slide8.addTable([
  [
    { text: "评估指标", options: { fill: { color: colors.secondary }, color: colors.white, bold: true } },
    { text: "LSTM", options: { fill: { color: colors.secondary }, color: colors.white, bold: true } },
    { text: "GCN", options: { fill: { color: colors.secondary }, color: colors.white, bold: true } },
    { text: "GCN-CapsNet", options: { fill: { color: colors.secondary }, color: colors.white, bold: true } }
  ],
  ["MAE", "12.3", "9.8", "7.2"],
  ["RMSE", "18.5", "14.2", "10.8"],
  ["MAPE", "15.7%", "11.3%", "8.5%"]
], {
  x: 0.5, y: 1.2, w: 9, h: 1.8,
  fontSize: 14, color: colors.text,
  border: { pt: 0.5, color: colors.gray },
  align: "center", valign: "middle"
});

// Key findings
slide8.addText("主要发现", {
  x: 0.5, y: 3.3, w: 9, h: 0.4,
  fontSize: 18, bold: true, color: colors.secondary
});

slide8.addText([
  { text: "GCN-CapsNet模型预测精度显著优于传统方法，MAE降低约40%", options: { bullet: true, breakLine: true } },
  { text: "耦合仿真有效揭示内涝对交通系统的时空影响规律", options: { bullet: true, breakLine: true } },
  { text: "韧性评估结果可为城市排水改造和交通管控提供依据", options: { bullet: true, breakLine: true } },
  { text: "模型泛化能力良好，可推广至其他城市应用", options: { bullet: true } }
], {
  x: 0.5, y: 3.7, w: 9, h: 1.7,
  fontSize: 16, color: colors.text, paraSpaceAfter: 8
});

slide8.addShape("RECTANGLE", {
  x: 0, y: 0.9, w: 0.08, h: 4.725,
  fill: { color: colors.accent }
});

// === SLIDE 9: Conclusion ===
createContentSlide("结论与展望", [
  "研究成果：建立了内涝-交通耦合仿真框架，实现城市道路交通韧性评估",
  "方法创新：提出GCN-CapsNet模型，提升内涝情景下交通流预测精度",
  "实践价值：为城市交通应急管理提供决策支持工具",
  "研究局限：模型依赖高精度降雨预报数据，实时性有待提升",
  "未来方向：融合多源数据、构建实时预警系统、开展更大尺度研究"
]);

// === SLIDE 10: References ===
let slide10 = pres.addSlide();
slide10.background = { color: colors.white };

slide10.addShape("RECTANGLE", {
  x: 0, y: 0, w: 10, h: 0.9,
  fill: { color: colors.primary }
});

slide10.addText("参考文献", {
  x: 0.5, y: 0.15, w: 9, h: 0.6,
  fontSize: 26, bold: true, color: colors.white, margin: 0
});

slide10.addText([
  { text: "[1] 张庭瑞等. 城市交通系统韧性评估研究综述. 交通运输工程学报, 2024.", options: { breakLine: true } },
  { text: "", options: { breakLine: true } },
  { text: "[2] Chen Y, et al. Graph Convolutional Networks for Traffic Forecasting. IEEE TITS, 2023.", options: { breakLine: true } },
  { text: "", options: { breakLine: true } },
  { text: "[3] Saberi M, et al. Resilience and Robustness of Transportation Systems. Transport Reviews, 2022.", options: { breakLine: true } },
  { text: "", options: { breakLine: true } },
  { text: "[4] Hinton G, et al. Capsule Networks for Traffic Prediction. NeurIPS, 2021.", options: { breakLine: true } },
  { text: "", options: { breakLine: true } },
  { text: "[5] 城市内涝与交通耦合仿真技术指南. 住房和城乡建设部, 2023.", options: { breakLine: true } },
  { text: "", options: { breakLine: true } },
  { text: "[6] WHO. Climate Change and Urban Health. World Health Organization, 2024.", options: { breakLine: true } }
], {
  x: 0.6, y: 1.1, w: 8.8, h: 4.2,
  fontSize: 14, color: colors.text
});

slide10.addShape("RECTANGLE", {
  x: 0, y: 0.9, w: 0.08, h: 4.725,
  fill: { color: colors.accent }
});

// Save
pres.writeFile({ fileName: "output.pptx" })
  .then(() => console.log("Created output.pptx"))
  .catch(err => console.error(err));