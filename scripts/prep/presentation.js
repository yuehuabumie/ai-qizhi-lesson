export const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
export const json = (v) => {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v ?? "");
  }
};
export const bytes = (n) => n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.ceil((n || 0) / 1024))} KB`;
export const statusMessage = (message) => /^正在(?:运行|启动)\s*DeepSeek\s*Harness$/i.test(String(message || "").trim()) ? "正在加载智能体" : message;
export const label = (key) => ({ name: "姓名 / 名称", className: "班级名称", title: "标题", description: "说明", instructions: "作业说明", studentNo: "学号", gender: "性别", score: "成绩", members: "学生名单", operations: "名单变更", groups: "小组", memberIds: "组员编号", questions: "题目", quiz: "试卷", stem: "题干", options: "选项", answer: "正确选项编号（从 0 开始）", explanation: "解析", points: "分值", type: "类型", action: "操作", status: "状态", classId: "班级编号", assignmentId: "作业编号", id: "编号", scoresPublished: "公布成绩", answersPublished: "公布答案", summary: "摘要", count: "数量", total: "总计", added: "新增", updated: "修改", removed: "删除", warnings: "待核对事项", students: "学生名单", payload: "操作内容" })[key] || key;
export const toolLabel = (name) => ({ create_class: "创建班级", create_classroom: "创建班级", edit_class_roster: "编辑班级名单", edit_roster: "编辑班级名单", update_roster: "编辑班级名单", save_groups: "保存小组", group_students: "分组", create_assignment: "创建作业", publish_assignment: "发布作业", publish_quiz_results: "公布试卷反馈", create_quiz: "创建试卷", list_classrooms: "查看班级", get_classroom: "读取班级名单", get_assignment: "读取作业", web_search: "联网检索", web_fetch: "阅读网页", read: "读取文件", read_file: "读取文件", read_image: "查看图片", write: "写入文件", edit: "编辑文件", bash: "运行沙箱命令", shell: "运行沙箱命令", subagent: "启动子任务", send_message: "协调子任务", todo_write: "更新任务计划", create_goal: "设置任务目标", skill: "使用技能", export_file: "交付生成文件", generate_lesson_image: "生成教学配图", job_output: "查看命令结果", job_kill: "停止沙箱命令" })[name] || String(name || "执行工具").replace(/_/g, " ");
