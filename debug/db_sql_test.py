import sqlite3

con = sqlite3.connect("scraper.db")
print("Total rows:", con.execute("SELECT COUNT(*) FROM cars").fetchone()[0])
for row in con.execute("SELECT * FROM cars ORDER BY scraped_at DESC LIMIT 5"):
    print(row)
con.close()
