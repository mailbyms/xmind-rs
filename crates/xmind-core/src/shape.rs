//! Topic outlines. Every shape the right panel offers is turned into an SVG
//! path in node-local coordinates, so the WebView only has to draw it.
//!
//! Names are the short form of XMind's `shape-class` values
//! (`org.xmind.topicShape.<name>`); punctuation shapes are approximated by a
//! plain rectangle because they are drawn as decorative brackets in the
//! shipped renderer.

const TAU: f64 = std::f64::consts::TAU;

fn n(value: f64) -> f64 { (value * 100.0).round() / 100.0 }

fn rect(w: f64, h: f64) -> String {
    format!("M 0 0 H {} V {} H 0 Z", n(w), n(h))
}

fn rounded_rect(w: f64, h: f64, r: f64) -> String {
    let r = r.min(w / 2.0).min(h / 2.0).max(0.0);
    if r <= 0.5 { return rect(w, h); }
    format!(
        "M {r} 0 H {x1} A {r} {r} 0 0 1 {w} {r} V {y1} A {r} {r} 0 0 1 {x1} {h} \
         H {r} A {r} {r} 0 0 1 0 {y1} V {r} A {r} {r} 0 0 1 {r} 0 Z",
        r = n(r), x1 = n(w - r), y1 = n(h - r), w = n(w), h = n(h),
    )
}

fn ellipse(w: f64, h: f64) -> String {
    let (rx, ry) = (n(w / 2.0), n(h / 2.0));
    format!(
        "M 0 {ry} A {rx} {ry} 0 1 1 {w} {ry} A {rx} {ry} 0 1 1 0 {ry} Z",
        rx = rx, ry = ry, w = n(w),
    )
}

fn circle(w: f64, h: f64) -> String {
    let d = w.min(h);
    let r = d / 2.0;
    let (cx, cy) = (w / 2.0, h / 2.0);
    format!(
        "M {x} {y0} A {r} {r} 0 1 1 {x} {y1} A {r} {r} 0 1 1 {x} {y0} Z",
        x = n(cx), y0 = n(cy - r), y1 = n(cy + r), r = n(r),
    )
}

fn polygon(points: &[(f64, f64)]) -> String {
    let mut path = String::new();
    for (index, (x, y)) in points.iter().enumerate() {
        path.push_str(if index == 0 { "M" } else { " L" });
        path.push_str(&format!(" {} {}", n(*x), n(*y)));
    }
    path.push_str(" Z");
    path
}

/// Star with `points` tips, `inner` ratio of the outer radius.
fn star(w: f64, h: f64) -> String {
    let (cx, cy) = (w / 2.0, h / 2.0);
    let (rx, ry) = (w / 2.0, h / 2.0);
    let mut points = Vec::new();
    for index in 0..10 {
        let radius = if index % 2 == 0 { 1.0 } else { 0.42 };
        let angle = -TAU / 4.0 + index as f64 * TAU / 10.0;
        points.push((cx + rx * radius * angle.cos(), cy + ry * radius * angle.sin()));
    }
    polygon(&points)
}

fn heart(w: f64, h: f64) -> String {
    format!(
        "M {cx} {h} C {q1x} {q1y}, 0 {q2y}, 0 {ry} \
         A {rx} {ry} 0 0 1 {cx} {ry} A {rx} {ry} 0 0 1 {w} {ry} \
         C {w} {q2y}, {q3x} {q1y}, {cx} {h} Z",
        cx = n(w / 2.0), h = n(h), w = n(w),
        rx = n(w / 4.0), ry = n(h * 0.28),
        q1x = n(w * 0.18), q1y = n(h * 0.82),
        q3x = n(w * 0.82),
        q2y = n(h * 0.62),
    )
}

fn cloud(w: f64, h: f64) -> String {
    format!(
        "M {a} {b} C {c} {d}, {e} {f}, {g} {i} C {j} {k}, {l} {m}, {o} {p} \
         C {q} {r}, {s} {t}, {u} {v} C {w1} {x1}, {y1} {z1}, {a2} {b2} \
         C {c2} {d2}, {e2} {f2}, {g2} {b} Z",
        a = n(w * 0.22), b = n(h * 0.45),
        c = n(w * 0.06), d = n(h * 0.2), e = n(w * 0.2), f = n(h * 0.04),
        g = n(w * 0.42), i = n(h * 0.06),
        j = n(w * 0.62), k = n(h * 0.0), l = n(w * 0.82), m = n(h * 0.12),
        o = n(w * 0.94), p = n(h * 0.1),
        q = n(w * 1.02), r = n(h * 0.4), s = n(w * 0.9), t = n(h * 0.66),
        u = n(w * 0.84), v = n(h * 0.86),
        w1 = n(w * 0.7), x1 = n(h * 0.98), y1 = n(w * 0.36), z1 = n(h * 0.94),
        a2 = n(w * 0.16), b2 = n(h * 0.92),
        c2 = n(w * 0.02), d2 = n(h * 0.76), e2 = n(w * 0.08), f2 = n(h * 0.56),
        g2 = n(w * 0.12),
    )
}

fn shield(w: f64, h: f64) -> String {
    format!(
        "M 0 0 H {w} V {a} C {w} {b}, {c} {h}, {cx} {h2} \
         C {d} {h}, 0 {b}, 0 {a} Z",
        w = n(w), a = n(h * 0.55), b = n(h * 0.82),
        c = n(w * 0.86), cx = n(w / 2.0), h2 = n(h),
        d = n(w * 0.14), h = n(h),
    )
}

fn drop(w: f64, h: f64) -> String {
    format!(
        "M 0 {r} A {r} {r} 0 0 1 {r} 0 H {x} A {r} {r} 0 0 1 {w} {r} \
         V {y} C {w} {c1}, {c2} {h}, {cx} {h} C {c3} {h}, 0 {c1}, 0 {y} Z",
        r = n(w.min(h) * 0.22), x = n(w - w.min(h) * 0.22), y = n(h * 0.55),
        w = n(w), h = n(h), cx = n(w / 2.0), c1 = n(h * 0.85),
        c2 = n(w * 0.82), c3 = n(w * 0.18),
    )
}

/// Banner with the V notch on the right edge.
fn bookmark(w: f64, h: f64) -> String {
    polygon(&[
        (0.0, 0.0), (w, 0.0), (w, h), (w / 2.0, h * 0.72), (0.0, h),
    ])
}

/// Rectangle with the right edge cut into a single break angle.
fn single_break_angle(w: f64, h: f64) -> String {
    let cut = (w * 0.16).min(h * 0.6);
    polygon(&[
        (0.0, 0.0), (w - cut, 0.0), (w - cut, h * 0.22), (w, h * 0.5),
        (w - cut, h * 0.78), (w - cut, h), (0.0, h),
    ])
}

fn fat_arrow(w: f64, h: f64, right: bool) -> String {
    let shaft = h * 0.42;
    let head = (w * 0.34).min(w);
    let points = if right {
        vec![
            (0.0, (h - shaft) / 2.0), (w - head, (h - shaft) / 2.0), (w - head, 0.0),
            (w, h / 2.0), (w - head, h), (w - head, (h + shaft) / 2.0), (0.0, (h + shaft) / 2.0),
        ]
    } else {
        vec![
            (w, (h - shaft) / 2.0), (head, (h - shaft) / 2.0), (head, 0.0),
            (0.0, h / 2.0), (head, h), (head, (h + shaft) / 2.0), (w, (h + shaft) / 2.0),
        ]
    };
    polygon(&points)
}

/// Stacked card: the main plate plus a second plate behind it to the right.
fn stack(w: f64, h: f64) -> String {
    let inset = (w * 0.05).min(10.0);
    format!(
        "{} {}",
        rounded_rect(w - inset, h - inset, 3.0),
        {
            let mut shifted = String::new();
            shifted.push_str(&format!(
                "M {} {} H {} V {} H {} Z",
                n(w - inset), n(inset), n(w), n(h - 2.0 * inset), n(w - inset),
            ));
            shifted
        }
    )
}

fn underline(w: f64, h: f64, double: bool) -> String {
    let inset = w * 0.02;
    let mut path = format!(
        "M {a} {y} H {b}",
        a = n(inset), b = n(w - inset), y = n(h - 2.0),
    );
    if double {
        path.push_str(&format!(
            " M {a} {y} H {b}",
            a = n(inset), b = n(w - inset), y = n(h - 6.0),
        ));
    }
    path
}

/// Returns the outline path and whether it encloses an area.
pub fn outline(shape: &str, w: f64, h: f64) -> (String, bool) {
    let w = w.max(4.0);
    let h = h.max(4.0);
    let r8 = 8.0_f64.min(h / 3.0);
    match shape {
        "rect" => (rect(w, h), true),
        "roundedRect" | "handDrawnRoundedRect" => (rounded_rect(w, h, r8), true),
        "handDrawnRect" => (rect(w, h), true),
        "ellipse" | "handDrawnEllipse" => (ellipse(w, h), true),
        "circle" => (circle(w, h), true),
        "ellipserect" | "ellipticrectangle" => (rounded_rect(w, h, h / 2.0), true),
        "diamond" => (polygon(&[(w / 2.0, 0.0), (w, h / 2.0), (w / 2.0, h), (0.0, h / 2.0)]), true),
        "cutdiamond" => (polygon(&[
            (w * 0.28, 0.0), (w * 0.72, 0.0), (w, h / 2.0),
            (w * 0.72, h), (w * 0.28, h), (0.0, h / 2.0),
        ]), true),
        "parallelogram" => {
            let off = (w * 0.18).min(w * 0.4);
            (polygon(&[(off, 0.0), (w, 0.0), (w - off, h), (0.0, h)]), true)
        }
        "hexagon" => {
            let cut = (w * 0.16).min(h * 0.4);
            (polygon(&[
                (cut, 0.0), (w - cut, 0.0), (w, h / 2.0),
                (w - cut, h), (cut, h), (0.0, h / 2.0),
            ]), true)
        }
        "roundedhexagon" => {
            let cut = (w * 0.16).min(h * 0.4);
            (format!(
                "M {a} 0 H {b} L {w} {my} L {b} {h} H {a} L 0 {my} Z",
                a = n(cut), b = n(w - cut), w = n(w), h = n(h), my = n(h / 2.0),
            ), true)
        }
        "underline" => (underline(w, h, false), false),
        "doubleunderline" => (underline(w, h, true), false),
        "stack" => (stack(w, h), true),
        "star" => (star(w, h), true),
        "heart" => (heart(w, h), true),
        "cloud" | "newcloud" | "simpleCloud" => (cloud(w, h), true),
        "shield" => (shield(w, h), true),
        "drop" | "waterdrop" => (drop(w, h), true),
        "bookmark" => (bookmark(w, h), true),
        "singlebreakangle" | "singlebreakanglewithline" => (single_break_angle(w, h), true),
        "fatRightArrow" => (fat_arrow(w, h, true), true),
        "fatLeftArrow" => (fat_arrow(w, h, false), true),
        "label" => {
            let tail = (h * 0.35).min(w * 0.2);
            (polygon(&[
                (0.0, 0.0), (w - tail, 0.0), (w, h / 2.0), (w - tail, h), (0.0, h),
            ]), true)
        }
        // Punctuation and unknown shapes fall back to a rounded plate so the
        // text stays legible; the panel still records the real class.
        _ => (rounded_rect(w, h, r8), true),
    }
}
