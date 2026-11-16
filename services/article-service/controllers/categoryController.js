const pool=require("../db/pool");
const {validId,httpError}=require("../services/articleService");
function validate(data) {
 const name=typeof data?.name === "string" ? data.name.trim() : "";
 const description=typeof data?.description === "string" ? data.description.trim() : "";
 if(name.length<2||name.length>80||description.length>500) throw httpError(400,"Invalid category fields");
 return {name,description};
}
exports.list=async(req,res,next)=>{try{
 const {rows}=await pool.query("SELECT category_id,name,description FROM categories ORDER BY name");
 res.json({categories:rows});
}catch(e){next(e);}};
exports.create=async(req,res,next)=>{try{
 const {name,description}=validate(req.body);
 const {rows}=await pool.query("INSERT INTO categories(name,description) VALUES($1,$2) RETURNING *",[name,description]);
 res.status(201).json({category:rows[0]});
}catch(e){next(e);}};
exports.update=async(req,res,next)=>{try{
 const id=validId(req.params.id),{name,description}=validate(req.body);
 const {rows}=await pool.query("UPDATE categories SET name=$1,description=$2 WHERE category_id=$3 RETURNING *",[name,description,id]);
 if(!rows[0]) throw httpError(404,"Category not found");
 res.json({category:rows[0]});
}catch(e){next(e);}};
exports.remove=async(req,res,next)=>{try{
 const id=validId(req.params.id);
 const {rowCount}=await pool.query("DELETE FROM categories WHERE category_id=$1 AND NOT EXISTS(SELECT 1 FROM articles WHERE category_id=$1)",[id]);
 if(!rowCount) throw httpError(409,"Category not found or in use");
 res.status(204).end();
}catch(e){next(e);}};
