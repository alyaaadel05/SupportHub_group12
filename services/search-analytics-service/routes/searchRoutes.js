const router = require("express").Router();
const controller = require("../controllers/searchController");
const { createLimiter } = require("../config/rateLimitProfiles");
const searchLimit = createLimiter("public-search", 120);
const clickLimit = createLimiter("search-click", 120);
router.get("/public/articles",searchLimit,controller.search);
router.get("/public/articles/:id",controller.article);
// Public click logging is rate-limited and never accesses private articles.
router.post("/public/search-clicks",clickLimit,controller.click);
module.exports = router;
