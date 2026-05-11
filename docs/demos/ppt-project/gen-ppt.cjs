const pptxgen = require("pptxgenjs");

const pres = new pptxgen();
pres.layout = "LAYOUT_16x9";
pres.title = "暴雨内涝下城市道路交通预演与韧性评估";
pres.author = "张庭瑞";

// Color palette
const DARK_BLUE = "1A365D";
const ACCENT_BLUE = "2B6CB0";
const LIGHT_BG = "F7FAFC";
const TEXT_DARK = "1A202C";
const TEXT_GRAY = "4A5568";

// Slide 1: Title Slide
let slide1 = pres.addSlide();
slide1.background = { color: DARK_BLUE };

// Decorative shape
slide1.addShape(pres.shapes.RECTANGLE, {
  x: 0, y: 4.2, w: 10, h: 1.425,
  fill: { color: ACCENT_BLUE, transparency: 30 }
});

slide1.addText("暴雨内涝下城市道路交通预演与韧性评估", {
  x: 0.5, y: 1.8, w: 9, h: 1.2,
  fontSize: 40, fontFace: "Microsoft YaHei", bold: true,
  color: "FFFFFF", align: "center"
});

slide1.addText("Urban Road Traffic Rehearsal and Resilience Assessment\nunder Rainstorm Waterlogging", {
  x: 0.5, y: 3.1, w: 9, h: 0.8,
  fontSize: 16, fontFace: "Arial",
  color: "CBD5E0", align: "center"
});

slide1.addText("武汉理工大学 交通与物流工程学院", {
  x: 0.5, y: 4.4, w: 9, h: 0.5,
  fontSize: 18, fontFace: "Microsoft YaHei",
  color: "FFFFFF", align: "center"
});

slide1.addText("张庭瑞 | 2024年12月", {
  x: 0.5, y: 4.95, w: 9, h: 0.4,
  fontSize: 14, fontFace: "Microsoft YaHei",
  color: "A0AEC0", align: "center"
});

// Slide 2: 研究背景
let slide2 = pres.addSlide();
slide2.background = { color: LIGHT_BG };

// Header bar
slide2.addShape(pres.shapes.RECTANGLE, {
  x: 0, y: 0, w: 10, h: 1,
  fill: { color: DARK_BLUE }
});

slide2.addText("研究背景", {
  x: 0.5, y: 0.2, w: 9, h: 0.6,
  fontSize: 32, fontFace: "Microsoft YaHei", bold: true,
  color: "FFFFFF", margin: 0
});

// Content boxes
const bgItems = [
  { icon: "!", title: "问题现状", content: "暴雨内涝具有突发性强、危害性大、影响范围广等特点，严重影响城市交通安全" },
  { icon: "?", title: "现实挑战", content: "当前暴雨内涝下的城市交通预案存在缺乏历史数据支撑、预防针对性不足、易造成资源浪费等问题" },
  { icon: "→", title: "研究目标", content: "面向暴雨内涝发生前的预防和准备，从交通韧性角度预演交通网络变化并进行动态评估" }
];

bgItems.forEach((item, i) => {
  const y = 1.3 + i * 1.4;
  
  // Icon circle
  slide2.addShape(pres.shapes.OVAL, {
    x: 0.6, y: y + 0.15, w: 0.6, h: 0.6,
    fill: { color: ACCENT_BLUE }
  });
  
  slide2.addText(item.icon, {
    x: 0.6, y: y + 0.15, w: 0.6, h: 0.6,
    fontSize: 20, fontFace: "Arial", bold: true,
    color: "FFFFFF", align: "center", valign: "middle"
  });
  
  // Content card
  slide2.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: 1.5, y: y, w: 8, h: 1.2,
    fill: { color: "FFFFFF" },
    line: { color: "E2E8F0", width: 1 },
    rectRadius: 0.1
  });
  
  slide2.addText(item.title, {
    x: 1.7, y: y + 0.1, w: 7.6, h: 0.4,
    fontSize: 16, fontFace: "Microsoft YaHei", bold: true,
    color: DARK_BLUE, margin: 0
  });
  
  slide2.addText(item.content, {
    x: 1.7, y: y + 0.5, w: 7.6, h: 0.6,
    fontSize: 13, fontFace: "Microsoft YaHei",
    color: TEXT_GRAY, margin: 0
  });
});

// Slide 3: 研究方法
let slide3 = pres.addSlide();
slide3.background = { color: LIGHT_BG };

// Header bar
slide3.addShape(pres.shapes.RECTANGLE, {
  x: 0, y: 0, w: 10, h: 1,
  fill: { color: DARK_BLUE }
});

slide3.addText("研究方法", {
  x: 0.5, y: 0.2, w: 9, h: 0.6,
  fontSize: 32, fontFace: "Microsoft YaHei", bold: true,
  color: "FFFFFF", margin: 0
});

// Three columns
const methods = [
  { num: "01", title: "内涝交通耦合仿真", items: ["SWMM地下管网模型", "WCA2D地表径流模型", "交通仿真动态反馈"] },
  { num: "02", title: "交通路网韧性评估", items: ["改进介数中心性模型", "基于最短时间路径", "流量加权动态特征"] },
  { num: "03", title: "GCN-CapsNet预测", items: ["三层图卷积网络", "胶囊网络空间特性", "快速韧性预测评估"] }
];

methods.forEach((method, i) => {
  const x = 0.5 + i * 3.1;
  
  // Card background
  slide3.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: x, y: 1.3, w: 2.9, h: 4,
    fill: { color: "FFFFFF" },
    line: { color: "E2E8F0", width: 1 },
    rectRadius: 0.1
  });
  
  // Number badge
  slide3.addShape(pres.shapes.OVAL, {
    x: x + 1.05, y: 1.5, w: 0.8, h: 0.8,
    fill: { color: ACCENT_BLUE }
  });
  
  slide3.addText(method.num, {
    x: x + 1.05, y: 1.5, w: 0.8, h: 0.8,
    fontSize: 18, fontFace: "Arial", bold: true,
    color: "FFFFFF", align: "center", valign: "middle"
  });
  
  // Title
  slide3.addText(method.title, {
    x: x + 0.15, y: 2.5, w: 2.6, h: 0.6,
    fontSize: 14, fontFace: "Microsoft YaHei", bold: true,
    color: DARK_BLUE, align: "center"
  });
  
  // Items
  slide3.addText(
    method.items.map((item, idx) => ({
      text: item,
      options: { bullet: true, breakLine: idx < method.items.length - 1 }
    })),
    {
      x: x + 0.2, y: 3.2, w: 2.5, h: 2,
      fontSize: 11, fontFace: "Microsoft YaHei",
      color: TEXT_GRAY, paraSpaceAfter: 8
    }
  );
});

// Slide 4: 实验结果
let slide4 = pres.addSlide();
slide4.background = { color: LIGHT_BG };

// Header bar
slide4.addShape(pres.shapes.RECTANGLE, {
  x: 0, y: 0, w: 10, h: 1,
  fill: { color: DARK_BLUE }
});

slide4.addText("实验结果", {
  x: 0.5, y: 0.2, w: 9, h: 0.6,
  fontSize: 32, fontFace: "Microsoft YaHei", bold: true,
  color: "FFFFFF", margin: 0
});

// Key metrics
const metrics = [
  { value: "95%+", label: "预测精度", desc: "GCN-CapsNet模型" },
  { value: "4级", label: "雨强验证", desc: "5/10/20/50年重现期" },
  { value: "3层", label: "网络聚合", desc: "图卷积信息提取" }
];

metrics.forEach((metric, i) => {
  const x = 0.7 + i * 3.1;
  
  slide4.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: x, y: 1.2, w: 2.8, h: 1.4,
    fill: { color: "FFFFFF" },
    line: { color: "E2E8F0", width: 1 },
    rectRadius: 0.1
  });
  
  slide4.addText(metric.value, {
    x: x, y: 1.3, w: 2.8, h: 0.7,
    fontSize: 32, fontFace: "Arial", bold: true,
    color: ACCENT_BLUE, align: "center"
  });
  
  slide4.addText(metric.label, {
    x: x, y: 1.95, w: 2.8, h: 0.35,
    fontSize: 13, fontFace: "Microsoft YaHei", bold: true,
    color: TEXT_DARK, align: "center"
  });
  
  slide4.addText(metric.desc, {
    x: x, y: 2.25, w: 2.8, h: 0.3,
    fontSize: 10, fontFace: "Microsoft YaHei",
    color: TEXT_GRAY, align: "center"
  });
});

// Findings section
slide4.addShape(pres.shapes.ROUNDED_RECTANGLE, {
  x: 0.5, y: 2.9, w: 9, h: 2.4,
  fill: { color: "FFFFFF" },
  line: { color: "E2E8F0", width: 1 },
  rectRadius: 0.1
});

slide4.addText("主要发现", {
  x: 0.7, y: 3.05, w: 8.6, h: 0.4,
  fontSize: 16, fontFace: "Microsoft YaHei", bold: true,
  color: DARK_BLUE
});

const findings = [
  "改进介数中心性模型能动态反映内涝情景下交通路段重要性变化",
  "雨型对路段错位程度排序影响较大，雨强影响较小",
  "GCN-CapsNet模型预测精度显著高于GCN模型，极端暴雨情形表现更优"
];

slide4.addText(
  findings.map((f, i) => ({
    text: f,
    options: { bullet: true, breakLine: i < findings.length - 1 }
  })),
  {
    x: 0.7, y: 3.5, w: 8.6, h: 1.7,
    fontSize: 13, fontFace: "Microsoft YaHei",
    color: TEXT_GRAY, paraSpaceAfter: 10
  }
);

// Slide 5: 结论
let slide5 = pres.addSlide();
slide5.background = { color: DARK_BLUE };

slide5.addText("结论", {
  x: 0.5, y: 0.4, w: 9, h: 0.8,
  fontSize: 36, fontFace: "Microsoft YaHei", bold: true,
  color: "FFFFFF"
});

// Three innovation highlights
const conclusions = [
  { num: "1", title: "耦合仿真推演方法", content: "提出一种不同强度暴雨内涝下城市道路交通模拟推演方法，耦合内涝与交通协同仿真" },
  { num: "2", title: "动态韧性评估方法", content: "提出一种面向城市内涝的区域交通路网动态韧性评估方法，基于改进介数中心性评估" },
  { num: "3", title: "预演评估系统开发", content: "开发一套暴雨内涝下城市道路交通预演与韧性评估系统，为交通预案提供支撑" }
];

conclusions.forEach((c, i) => {
  const y = 1.4 + i * 1.3;
  
  // Number
  slide5.addShape(pres.shapes.OVAL, {
    x: 0.6, y: y + 0.2, w: 0.5, h: 0.5,
    fill: { color: ACCENT_BLUE }
  });
  
  slide5.addText(c.num, {
    x: 0.6, y: y + 0.2, w: 0.5, h: 0.5,
    fontSize: 16, fontFace: "Arial", bold: true,
    color: "FFFFFF", align: "center", valign: "middle"
  });
  
  // Content
  slide5.addText(c.title, {
    x: 1.4, y: y + 0.1, w: 8, h: 0.4,
    fontSize: 18, fontFace: "Microsoft YaHei", bold: true,
    color: "FFFFFF"
  });
  
  slide5.addText(c.content, {
    x: 1.4, y: y + 0.55, w: 8, h: 0.6,
    fontSize: 13, fontFace: "Microsoft YaHei",
    color: "A0AEC0"
  });
});

// Bottom tagline
slide5.addShape(pres.shapes.RECTANGLE, {
  x: 0, y: 5, w: 10, h: 0.625,
  fill: { color: ACCENT_BLUE, transparency: 30 }
});

slide5.addText("研究成果对于推演城市内涝交通事件、制定灾前交通应急预案、减少交通中断经济损失具有重要参考价值", {
  x: 0.5, y: 5.1, w: 9, h: 0.5,
  fontSize: 12, fontFace: "Microsoft YaHei",
  color: "CBD5E0", align: "center"
});

// Save
pres.writeFile({ fileName: "ppt-project/交通系统应急管控与实践.pptx" })
  .then(() => console.log("PPT generated: ppt-project/交通系统应急管控与实践.pptx"))
  .catch(err => console.error("Error:", err));
