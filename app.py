from flask import Flask, render_template, abort
from ai_routes import ai_blueprint, limiter
from catalog import PRODUCTS

app = Flask(__name__)

# Ограничиваем размер входящих запросов.
app.config["MAX_CONTENT_LENGTH"] = 64 * 1024

limiter.init_app(app)
app.register_blueprint(ai_blueprint)

@app.template_filter("money")
def money(value):
    return f"{value:,}".replace(",", " ") + " ₸"

@app.get("/")
def home():
    return render_template("home.html", products=PRODUCTS[:3])

@app.get("/catalog")
def catalog():
    return render_template("catalog.html", products=PRODUCTS)

@app.get("/product/<int:product_id>")
def product(product_id):
    item = next((item for item in PRODUCTS if item["id"] == product_id), None)
    if item is None:
        abort(404)
    return render_template("product.html", product=item)

@app.get("/cart")
def cart():
    return render_template("cart.html")

@app.get("/assistant")
def assistant():
    return render_template("assistant.html")

@app.get("/info")
def info():
    return render_template("info.html")

@app.get("/api/products")
def products_api():
    return {"products": PRODUCTS}

if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=False)
