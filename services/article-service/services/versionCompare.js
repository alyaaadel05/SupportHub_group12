function compareVersions(a, b) {
  return {
    titleChanged: a.title !== b.title,
    contentChanged: a.content !== b.content,
    categoryChanged: Number(a.category_id) !== Number(b.category_id),
    before: { title: a.title, content: a.content, categoryId: a.category_id },
    after: { title: b.title, content: b.content, categoryId: b.category_id }
  };
}
module.exports = { compareVersions };
