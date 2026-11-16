const router = require("express").Router();
const controller = require("../controllers/searchController");
router.get("/public/articles",controller.search);
router.get("/public/articles/:id",controller.article);
// Public click logging is rate-limited and never accesses private articles.
router.post("/public/search-clicks",controller.click);
module.exports = router;
