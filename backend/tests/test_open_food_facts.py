from app.services.open_food_facts import normalize_product


def test_normalize_open_food_facts_nutrients_per_100g():
    product = normalize_product({
        "code": "12345678", "product_name": "Example oats", "brands": "Fit Foods", "serving_size": "40 g",
        "nutriments": {"energy-kcal_100g": 372, "proteins_100g": 13.5, "carbohydrates_100g": 60, "fat_100g": 7, "fiber_100g": 10},
    })
    assert product == {"barcode": "12345678", "name": "Example oats", "brand": "Fit Foods", "serving_g": 40.0, "calories": 372.0, "protein_g": 13.5, "carbs_g": 60.0, "fat_g": 7.0, "fiber_g": 10.0, "source": "open_food_facts"}
