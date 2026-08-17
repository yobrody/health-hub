"""/food/search must derive sodium from salt when OFF only supplies salt —
matching /barcode (extract_off_nutrients). Previously search showed sodium_mg:0
for a product that OFF only annotates with salt."""
import os
os.environ.setdefault("HEALTH_API_KEY", "test")
import main


def test_sodium_direct_when_present():
    assert main._sodium_mg_per_100g({"sodium_100g": 0.4}) == 400  # 0.4 g → 400 mg


def test_sodium_from_salt_when_off_lacks_sodium():
    assert main._sodium_mg_per_100g({"salt_100g": 1.25}) == 500  # salt 1.25g → 500 mg sodium


def test_zero_when_neither():
    assert main._sodium_mg_per_100g({}) == 0
