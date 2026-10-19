import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowUpLeft, BadgeCheck, BedDouble, Building2, Check, ChevronDown, CircleHelp, Heart, Home, MapPin, Ruler, Search, SlidersHorizontal, Sparkles, Wallet } from 'lucide-react';

type Listing = { id: string; title: string; city: string; neighborhood: string; price: number; salePrice?: number; monthlyRent?: number; deposit?: number; area: number; rooms: number; kind: 'buy' | 'rent'; source: string; url?: string; updatedAt: string; verified: boolean; score?: number; reasons?: string[]; image?: string };
type ApiListing = { id: string; title: string; city: string; neighborhood?: string; price: number; salePrice?: number; monthlyRent?: number; deposit?: number; areaM2?: number; bedrooms?: number; transactionType: 'buy' | 'rent'; source: string; sourceUrl?: string; last_seen_at?: string; score: number; reasons: string[]; freshness?: number };
const demo: Listing[] = [
  { id: 'd-101', title: 'آپارتمان نورگیر با نقشه‌ی خوش‌چیدمان', city: 'تهران', neighborhood: 'پونک', price: 7800000000, area: 105, rooms: 2, kind: 'buy', source: 'نمونه‌ی نمایشی', updatedAt: 'امروز', verified: false, score: 96, reasons: ['متراژ نزدیک به خواسته‌ی شما', 'دو اتاق خواب', 'در محدوده‌ی بودجه'], image: 'https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=900&q=85' },
  { id: 'd-102', title: 'واحد مدرن با بالکن دلباز', city: 'تهران', neighborhood: 'جنت‌آباد', price: 6950000000, area: 98, rooms: 2, kind: 'buy', source: 'نمونه‌ی نمایشی', updatedAt: 'دیروز', verified: false, score: 91, reasons: ['قیمت مناسب‌تر', 'دو اتاق خواب', 'محله‌ی انتخابی'], image: 'https://images.unsplash.com/photo-1600566753086-00f18fb6b3ea?auto=format&fit=crop&w=900&q=85' },
  { id: 'd-103', title: 'خانه‌ی آرام با پنجره‌های بزرگ', city: 'تهران', neighborhood: 'مرزداران', price: 8200000000, area: 112, rooms: 2, kind: 'buy', source: 'نمونه‌ی نمایشی', updatedAt: '۲ روز پیش', verified: false, score: 84, reasons: ['متراژ بیشتر', 'دو اتاق خواب'], image: 'https://images.unsplash.com/photo-1600607687920-4e2a09cf159d?auto=format&fit=crop&w=900&q=85' },
  { id: 'd-104', title: 'آپارتمان اجاره‌ای دوخوابه', city: 'تهران', neighborhood: 'پونک', price: 35000000, monthlyRent: 35000000, deposit: 300000000, area: 92, rooms: 2, kind: 'rent', source: 'نمونه‌ی نمایشی', updatedAt: 'نمونه', verified: false, score: 88, reasons: ['اجاره‌ی ماهانه در محدوده‌ی بودجه', 'دو اتاق خواب'] },
];
const money = (value: number) => new Intl.NumberFormat('fa-IR').format(value);
const compactMoney = (value: number) => value >= 1_000_000_000 ? `${(value / 1_000_000_000).toLocaleString('fa-IR', { maximumFractionDigits: 1 })} میلیارد` : `${money(value / 1_000_000)} میلیون`;

export default function App() {
  const [kind, setKind] = useState<'buy' | 'rent'>('buy');
  const [city, setCity] = useState('تهران');
  const [neighborhood, setNeighborhood] = useState('همه‌ی محله‌ها');
  const [budget, setBudget] = useState(9_000_000_000);
  const [area, setArea] = useState(90);
  const [rooms, setRooms] = useState('2 اتاق');
  const [propertyType, setPropertyType] = useState('apartment');
  const [listingUrl, setListingUrl] = useState('');
  const [importing, setImporting] = useState(false);
  const [apiResults, setApiResults] = useState<Listing[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState('');
  const [saved, setSaved] = useState<string[]>([]);
  const [showFilters, setShowFilters] = useState(true);
  const apiBase = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '');

  const results = useMemo(() => (apiResults ?? demo).filter((x) => x.kind === kind && x.city === city && x.price <= budget && x.area >= area && x.rooms >= Number.parseInt(rooms, 10) && (neighborhood === 'همه‌ی محله‌ها' || x.neighborhood === neighborhood)).sort((a, b) => (b.score ?? 0) - (a.score ?? 0)), [apiResults, kind, city, budget, area, rooms, neighborhood]);
  useEffect(() => { document.documentElement.lang = 'fa'; document.documentElement.dir = 'rtl'; }, []);
  useEffect(() => { setBudget(kind === 'buy' ? 9_000_000_000 : 50_000_000); }, [kind]);

  async function findHomes() {
    setLoading(true); setNotice('');
    if (apiBase) {
      try {
        const preferenceId = crypto.randomUUID();
        const preferences = { transactionType: kind, city, neighborhoods: neighborhood === 'همه‌ی محله‌ها' ? [] : [neighborhood], budgetMax: budget, minAreaM2: area, minBedrooms: Number(rooms[0]), propertyTypes: [propertyType] };
        const savedPreferences = await fetch(`${apiBase}/api/preferences/${preferenceId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(preferences) });
        if (!savedPreferences.ok) throw new Error(`Preferences HTTP ${savedPreferences.status}`);
        const response = await fetch(`${apiBase}/api/recommendations/${preferenceId}`, { method: 'POST' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json() as { items?: Array<{ listing: ApiListing; score: number; reasons: string[]; freshness?: number }> };
        setApiResults((data.items ?? []).map(({ listing, score, reasons }) => ({ id: listing.id, title: listing.title, city: listing.city, neighborhood: listing.neighborhood ?? 'محله ثبت نشده', price: listing.transactionType === 'rent' ? (listing.monthlyRent ?? listing.price) : (listing.salePrice ?? listing.price), salePrice: listing.salePrice, monthlyRent: listing.monthlyRent, deposit: listing.deposit, area: listing.areaM2 ?? 0, rooms: listing.bedrooms ?? 0, kind: listing.transactionType, source: listing.source, url: listing.sourceUrl, updatedAt: listing.last_seen_at ? new Date(listing.last_seen_at).toLocaleDateString('fa-IR') : 'زمان نامشخص', verified: false, score, reasons })));
        setNotice('نتایج از سرویس جست‌وجو دریافت شد. وضعیت هر آگهی را پیش از تماس بررسی کنید.');
      } catch { setApiResults(null); setNotice('ارتباط با سرویس برقرار نشد؛ فعلاً نمونه‌های نمایشی را می‌بینید.'); }
    } else {
      setApiResults(null); setNotice('این‌ها آگهی‌های نمونه برای نمایش رابط کاربری هستند؛ هنوز آگهی واقعی از دیوار یا شیپور دریافت نشده است.');
    }
    setLoading(false);
  }

  /** Imports a single listing page that the user pasted. */
  async function submitListingLink() {
    const url = listingUrl.trim();
    if (!url) { setNotice('نشانی آگهی را وارد کنید.'); return; }
    if (!apiBase) { setNotice('برای ثبت آگهی باید سرویس جست‌وجو در دسترس باشد.'); return; }
    setImporting(true); setNotice('');
    try {
      const response = await fetch(`${apiBase}/api/listings/import-link`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) });
      const payload = await response.json() as { listing?: { title?: string; sourceUrl?: string }; created?: boolean; error?: { message?: string } };
      if (!response.ok) { setNotice(payload.error?.message ?? 'ثبت این آگهی ممکن نشد.'); return; }
      setListingUrl('');
      setNotice(`آگهی «${payload.listing?.title ?? 'بدون عنوان'}» ثبت شد و در نتایج جست‌وجو برای شما نمایش داده می‌شود.`);
      await findHomes();
    } catch { setNotice('ثبت آگهی ممکن نشد؛ اتصال به سرویس را بررسی کنید.'); }
    finally { setImporting(false); }
  }

  return <div className="app-shell">
    <header className="topbar"><a className="brand" href="#top" aria-label="خانه‌یاب"><span className="brand-mark"><Home size={21} strokeWidth={2.5}/></span><span>خانه‌یاب<small>انتخاب آگاهانه‌ی خانه</small></span></a><nav><a href="#results">پیشنهادها</a><a href="#how">چطور کار می‌کند؟</a></nav><button className="account-button" onClick={() => setNotice('ذخیره‌ی دائمی حساب کاربری در نسخه‌ی بعدی با احراز هویت فعال می‌شود.')}>ورود / ثبت‌نام <ArrowLeft size={16}/></button></header>
    <main id="top">
      <section className="hero"><div className="hero-copy"><div className="eyebrow"><Sparkles size={15}/> جست‌وجو بر اساس نیاز واقعی شما</div><h1>خانه‌ای که به زندگی‌ات<br/><span>می‌آید، پیدا کن.</span></h1><p>مشخصات خانه‌ی دلخواهت را بگو؛ پیشنهادها را بر اساس بودجه، متراژ و اولویت‌هایت مرتب می‌کنیم تا انتخاب ساده‌تر شود.</p><div className="hero-trust"><span><Check size={15}/> دلیل هر پیشنهاد مشخص است</span><span><Check size={15}/> لینک مستقیم آگهی</span></div></div><div className="hero-art"><div className="sun"/><div className="house house-back"/><div className="house house-front"><div className="window w1"/><div className="window w2"/><div className="door"/></div><div className="floating-note"><span className="note-icon"><Sparkles size={18}/></span><div><b>پیشنهاد متناسب با تو</b><small>بر اساس اولویت‌هایت</small></div><span className="note-percent">۹۶٪</span></div><div className="art-ground"/></div></section>
      <section className="search-panel" aria-labelledby="search-heading"><div className="panel-heading"><div><span className="section-kicker">جست‌وجوی شخصی</span><h2 id="search-heading">چه خانه‌ای دنبالش هستی؟</h2></div><span className="step-pill">۱ <span>از</span> ۱</span></div><div className="segmented"><button className={kind === 'buy' ? 'active' : ''} onClick={() => setKind('buy')}><Building2 size={17}/> خرید خانه</button><button className={kind === 'rent' ? 'active' : ''} onClick={() => setKind('rent')}><Home size={17}/> رهن و اجاره</button></div>
        <div className="form-grid"><label className="field"><span><MapPin size={15}/> شهر</span><select value={city} onChange={(e) => setCity(e.target.value)}><option>تهران</option><option>کرج</option><option>اصفهان</option><option>مشهد</option><option>شیراز</option></select><ChevronDown className="select-chevron" size={15}/></label><label className="field"><span><MapPin size={15}/> محله</span><select value={neighborhood} onChange={(e) => setNeighborhood(e.target.value)}><option>همه‌ی محله‌ها</option><option>پونک</option><option>جنت‌آباد</option><option>مرزداران</option></select><ChevronDown className="select-chevron" size={15}/></label><label className="field"><span><Wallet size={15}/> {kind === 'buy' ? 'حداکثر قیمت کل' : 'حداکثر اجاره‌ی ماهانه'}</span><select value={budget} onChange={(e) => setBudget(Number(e.target.value))}>{kind === 'buy' ? <><option value={5000000000}>۵ میلیارد تومان</option><option value={7000000000}>۷ میلیارد تومان</option><option value={9000000000}>۹ میلیارد تومان</option><option value={12000000000}>۱۲ میلیارد تومان</option></> : <><option value={20000000}>۲۰ میلیون تومان</option><option value={35000000}>۳۵ میلیون تومان</option><option value={50000000}>۵۰ میلیون تومان</option><option value={100000000}>۱۰۰ میلیون تومان</option></>}</select><ChevronDown className="select-chevron" size={15}/></label><label className="field"><span><Ruler size={15}/> حداقل متراژ</span><select value={area} onChange={(e) => setArea(Number(e.target.value))}><option value={50}>۵۰ متر</option><option value={70}>۷۰ متر</option><option value={90}>۹۰ متر</option><option value={110}>۱۱۰ متر</option></select><ChevronDown className="select-chevron" size={15}/></label><label className="field"><span><BedDouble size={15}/> اتاق خواب</span><select value={rooms} onChange={(e) => setRooms(e.target.value)}><option value="1 اتاق">۱ اتاق</option><option value="2 اتاق">۲ اتاق</option><option value="3 اتاق">۳ اتاق</option><option value="4 اتاق">۴ اتاق</option></select><ChevronDown className="select-chevron" size={15}/></label><label className="field"><span><Building2 size={15}/> نوع ملک</span><select value={propertyType} onChange={(e) => setPropertyType(e.target.value)}><option value="apartment">آپارتمان</option><option value="house">خانه</option><option value="villa">ویلا</option><option value="land">زمین</option><option value="shop">مغازه</option><option value="office">اداری</option></select><ChevronDown className="select-chevron" size={15}/></label><button className="search-button" onClick={findHomes} disabled={loading}>{loading ? <span className="spinner"/> : <Search size={19}/>} {loading ? 'در حال جست‌وجو...' : 'پیدا کردن خانه'}</button></div>
      </section>
      <section className="search-panel link-panel" aria-labelledby="link-heading"><div className="panel-heading"><div><span className="section-kicker">افزودن آگهی</span><h2 id="link-heading">لینک آگهی را بفرستید</h2></div></div><p className="link-help">آگهی‌ای را در دیوار یا شیپور دیده‌اید؟ نشانی همان صفحه را بفرستید تا در جست‌وجوی شما هم بررسی شود. تنها اطلاعات لازم برای تطبیق ذخیره می‌شود و لینک اصلی آگهی برای شما نگه داشته می‌شود.</p><div className="link-row"><input type="url" value={listingUrl} onChange={(e) => setListingUrl(e.target.value)} placeholder="https://www.divar.ir/v/…" aria-label="نشانی آگهی" /><button className="search-button" onClick={submitListingLink} disabled={importing}>{importing ? 'در حال ثبت...' : 'ثبت آگهی'}</button></div></section>
      <section className="results-section" id="results"><div className="results-head"><div><span className="section-kicker">پیشنهادهای هوشمند</span><h2>خانه‌هایی برای تو <span className="result-count">{money(results.length)} مورد</span></h2><p>بر اساس نزدیکی به بودجه، متراژ و محله مرتب شده‌اند.</p></div><button className="filter-toggle" onClick={() => setShowFilters(!showFilters)}><SlidersHorizontal size={16}/> {showFilters ? 'فیلترها فعال' : 'نمایش فیلترها'}</button></div>
        {showFilters && <div className="active-filters"><span><Check size={13}/> {city}</span><span><Wallet size={13}/> {kind === 'buy' ? 'قیمت کل تا' : 'اجاره‌ی ماهانه تا'} {compactMoney(budget)} تومان</span><span><Ruler size={13}/> از {money(area)} متر</span><span><BedDouble size={13}/> {rooms}</span></div>}
        {kind === 'rent' && <div className="notice" role="status"><CircleHelp size={17}/><span>در آگهی‌های واقعی، اجاره‌ی ماهانه و ودیعه جدا نمایش داده می‌شوند. نمونه‌های نمایشی برای تصمیم مالی قابل اتکا نیستند.</span></div>}
        {notice && <div className="notice" role="status"><CircleHelp size={17}/><span>{notice}</span></div>}
        {results.length === 0 ? <div className="empty-state"><Search size={30}/><h3>با این مشخصات موردی پیدا نشد</h3><p>بودجه یا حداقل متراژ را تغییر بده و دوباره جست‌وجو کن.</p><button onClick={() => { setBudget(12000000000); setArea(70); }}>گسترده‌تر جست‌وجو کن</button></div> : <div className="listing-grid">{results.map((item) => <article className="listing-card" key={item.id}><div className="listing-image" style={item.image ? { backgroundImage: `url("${item.image}")` } : undefined}><span className="match-badge"><Sparkles size={13}/> {money(item.score ?? 0)}٪ تطابق</span><button className={`save-button ${saved.includes(item.id) ? 'saved' : ''}`} aria-label="ذخیره آگهی" onClick={() => setSaved((s) => s.includes(item.id) ? s.filter((id) => id !== item.id) : [...s, item.id])}><Heart size={18} fill={saved.includes(item.id) ? 'currentColor' : 'none'}/></button></div><div className="listing-content"><div className="listing-location"><MapPin size={14}/>{item.city}، {item.neighborhood}<span>•</span>{item.updatedAt}</div><h3>{item.title}</h3><div className="listing-specs"><span><Ruler size={15}/>{money(item.area)} متر</span><span><BedDouble size={15}/>{money(item.rooms)} اتاق</span></div><div className="listing-price"><small>{kind === 'buy' ? 'قیمت کل' : 'اجاره‌ی ماهانه'}</small><b>{compactMoney(item.price)} <small>تومان</small></b>{kind === 'rent' && item.deposit !== undefined && <small className="deposit-price">ودیعه: {compactMoney(item.deposit)} تومان</small>}</div><div className="reasons"><b><Sparkles size={14}/> چرا این پیشنهاد؟</b>{(item.reasons ?? ['مطابقت با فیلترهای انتخابی']).slice(0, 2).map((reason) => <span key={reason}><Check size={12}/>{reason}</span>)}</div><div className="listing-footer"><span className="source-label"><span className="source-dot"/>{item.source}</span><span className={item.verified ? 'verification verified' : 'verification'}>{item.verified ? <BadgeCheck size={14}/> : <CircleHelp size={14}/>} {item.verified ? 'تأیید شده' : 'تأییدنشده'}</span></div><a className="details-link" href={item.url ?? '#source-info'} target={item.url ? '_blank' : undefined} rel={item.url ? 'noreferrer' : undefined} onClick={(e) => { if (!item.url) { e.preventDefault(); setNotice('این کارت نمایشی است و لینک آگهی واقعی ندارد.'); } }}>مشاهده‌ی آگهی <ArrowUpLeft size={17}/></a></div></article>)}</div>}
        <div className="source-disclosure" id="source-info"><CircleHelp size={17}/><p><b>درباره‌ی صحت آگهی‌ها</b><br/>نمونه‌های فعلی برای نمایش عملکرد رابط کاربری هستند. برای دریافت آگهی واقعی، اتصال مجاز به منبع باید پیکربندی شود. زمان به‌روزرسانی و وضعیت تأیید هر آگهی باید پیش از تصمیم‌گیری بررسی شود.</p></div>
      </section>
      <section className="how-section" id="how"><div><span className="section-kicker">سه قدم تا انتخاب بهتر</span><h2>جست‌وجو، با دلیل</h2><p>خانه‌یاب کمک می‌کند گزینه‌ها را با معیارهای خودت مقایسه کنی.</p></div><div className="how-steps"><div><span>۰۱</span><b>نیازت را مشخص کن</b><p>بودجه، محله، متراژ و تعداد اتاق را انتخاب کن.</p></div><div><span>۰۲</span><b>پیشنهادها را مقایسه کن</b><p>امتیاز تطابق و دلیل قرار گرفتن هر ملک را ببین.</p></div><div><span>۰۳</span><b>به منبع آگهی برو</b><p>اطلاعات و در دسترس بودن آگهی را از منبع بررسی کن.</p></div></div></section>
    </main><footer><a className="brand footer-brand" href="#top"><span className="brand-mark"><Home size={18}/></span><span>خانه‌یاب<small>تصمیم بهتر برای خانه</small></span></a><span>پیشنهادها برای کمک به تصمیم‌گیری هستند؛ صحت و موجودی آگهی باید از منبع بررسی شود.</span><a href="#source-info">سیاست شفافیت آگهی‌ها</a></footer>
  </div>;
}
