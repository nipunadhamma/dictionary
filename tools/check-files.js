var fs = require("fs"), p = require("path");
var root = "E:/DICTIONARY/dictionary.suththa.org";

var htmlFiles = ["index.html", "entry.html", "editor.html", "review.html", "dashboard.html", "login.html"];
htmlFiles.forEach(function(f) {
    var content = fs.readFileSync(p.join(root, f), "utf8");
    var hasStatic = content.indexOf('js/static.js') !== -1;
    var hasResolver = content.indexOf('js/resolver.js') !== -1;
    console.log(f + ": static=" + hasStatic + " resolver=" + hasResolver);
});

var jsFiles = ["js/static.js", "js/resolver.js", "js/search.js", "js/entry.js", "js/editor.js", "js/review.js", "js/dashboard.js"];
jsFiles.forEach(function(f) {
    var exists = fs.existsSync(p.join(root, f));
    var size = exists ? fs.statSync(p.join(root, f)).size : 0;
    console.log(f + ": " + (exists ? "OK" : "MISSING") + " (" + (size / 1024).toFixed(1) + " KB)");
});

// Check offline.html unchanged
var offlineHash = require("crypto").createHash("sha256").update(fs.readFileSync(p.join(root, "offline.html"))).digest("hex").toUpperCase();
var expected = "B708182619F6B825C08B581ADC70281DA0F8A6891C78C8402905559BA17F9B39";
console.log("\noffline.html SHA256: " + offlineHash);
console.log("offline.html preserved: " + (offlineHash === expected));
