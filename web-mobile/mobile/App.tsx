import React, { useEffect, useState } from 'react';
import { SafeAreaView, ScrollView, StatusBar, StyleSheet, Text, TextInput, TouchableOpacity, View, Linking, ActivityIndicator, Platform } from 'react-native';
import { StatusBar as ExpoStatusBar } from 'expo-status-bar';
import * as Crypto from 'expo-crypto';
import { clearProfile, loadProfile, saveProfile, toggleSaved, type DeviceProfile } from './profile';

type HomeItem = { id: string; title: string; city: string; neighborhood: string; price: number; monthlyRent?: number; deposit?: number; area: number; rooms: number; score: number; source: string; url?: string; reasons?: string[]; verified?: boolean; stale?: boolean };
/** The API returns stable reason codes; this map localizes them for the interface. */
const REASON_LABELS: Record<string, string> = {
  TRANSACTION_MATCH: 'نوع معامله مطابق ترجیح شماست',
  LOCATION_MATCH: 'شهر موردنظر شماست',
  NEIGHBORHOOD_MATCH: 'محله در فهرست ترجیحی شماست',
  PROPERTY_TYPE_MATCH: 'نوع ملک مطابق ترجیح شماست',
  WITHIN_BUDGET: 'قیمت در بازهٔ بودجهٔ شماست',
  ROOMS_MATCH: 'تعداد اتاق‌خواب کافی است',
  AREA_MATCH: 'متراژ موردنیاز را دارد',
  FEATURES_MATCH: 'امکانات ضروری را دارد',
  PREFERENCE_MATCH: 'ویژگی نامطلوبی در آگهی پیدا نشد',
  MISSING_KEY_FIELDS: 'بعضی اطلاعات این آگهی نامشخص است',
  STALE_LISTING: 'این آگهی قدیمی است و موجودی آن تأیید نشده',
};
const demo: HomeItem[] = [
  { id: 'm1', title: 'آپارتمان نورگیر با نقشه‌ی خوش‌چیدمان', city: 'تهران', neighborhood: 'پونک', price: 7800000000, area: 105, rooms: 2, score: 96, source: 'نمونه‌ی نمایشی', reasons: ['متراژ نزدیک به خواسته‌ی شما', 'دو اتاق خواب'] },
  { id: 'm2', title: 'واحد مدرن با بالکن دلباز', city: 'تهران', neighborhood: 'جنت‌آباد', price: 6950000000, area: 98, rooms: 2, score: 91, source: 'نمونه‌ی نمایشی', reasons: ['قیمت مناسب‌تر', 'دو اتاق خواب'] },
  { id: 'm3', title: 'خانه‌ی آرام با پنجره‌های بزرگ', city: 'تهران', neighborhood: 'مرزداران', price: 8200000000, area: 112, rooms: 2, score: 84, source: 'نمونه‌ی نمایشی', reasons: ['متراژ بیشتر', 'دو اتاق خواب'] },
  { id: 'm4', title: 'آپارتمان اجاره‌ای دوخوابه', city: 'تهران', neighborhood: 'پونک', price: 35000000, monthlyRent: 35000000, deposit: 300000000, area: 92, rooms: 2, score: 88, source: 'نمونه‌ی نمایشی', reasons: ['اجاره‌ی ماهانه در محدوده‌ی بودجه', 'دو اتاق خواب'] },
];
const money = (n: number) => new Intl.NumberFormat('fa-IR').format(n);
export default function App() {
  const [budget, setBudget] = useState('9000000000');
  const [transactionType, setTransactionType] = useState<'buy' | 'rent'>('buy');
  const [area, setArea] = useState('90');
  const [results, setResults] = useState<HomeItem[]>(demo.filter((item) => item.monthlyRent === undefined));
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('نمونه‌های نمایشی؛ برای دیدن آگهی واقعی، لینک آگهی را ثبت کنید.');
  const [listingUrl, setListingUrl] = useState('');
  const [importing, setImporting] = useState(false);
  const [profile, setProfile] = useState<DeviceProfile | null>(null);
  const [showProfile, setShowProfile] = useState(false);
  const [profileNotice, setProfileNotice] = useState('');
  useEffect(() => {
    // The profile lives on this phone only; it fills the form on the first visit.
    loadProfile().then((stored) => {
      setProfile(stored);
      setTransactionType(stored.transactionType);
      if (stored.budgetMax) setBudget(String(stored.budgetMax));
      if (stored.minAreaM2) setArea(String(stored.minAreaM2));
    });
  }, []);
  useEffect(() => {
    // The web build is served as an installable PWA; the native builds do not need it.
    if (Platform.OS !== 'web' || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  }, []);
  async function search() {
    setLoading(true); const base = process.env.EXPO_PUBLIC_API_BASE_URL?.replace(/\/$/, '');
    if (base) {
      try { const id = Crypto.randomUUID(); const p = await fetch(`${base}/api/preferences/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ transactionType, city: 'تهران', budgetMax: Number(budget), minAreaM2: Number(area), minBedrooms: 2, propertyTypes: [], neighborhoods: [], mustHave: [], avoid: [] }) }); if (!p.ok) throw new Error('preference save failed'); const r = await fetch(`${base}/api/recommendations/${id}`, { method: 'POST' }); if (!r.ok) throw new Error('request failed'); const data = await r.json() as { items?: Array<{ listing: { id: string; title: string; city: string; neighborhood?: string; price: number; monthlyRent?: number; deposit?: number; areaM2?: number; bedrooms?: number; source: string; sourceUrl?: string; stale?: boolean; transactionType: 'buy' | 'rent' }; score: number; reasons: string[]; reasonLabels?: string[] }> }; setResults((data.items ?? []).map(({ listing, score, reasons, reasonLabels }) => ({ id: listing.id, title: listing.title, city: listing.city, neighborhood: listing.neighborhood ?? 'محله ثبت نشده', price: listing.transactionType === 'rent' ? (listing.monthlyRent ?? listing.price) : listing.price, monthlyRent: listing.monthlyRent, deposit: listing.deposit, area: listing.areaM2 ?? 0, rooms: listing.bedrooms ?? 0, score, source: listing.source, url: listing.sourceUrl, stale: listing.stale, reasons: reasonLabels?.length ? reasonLabels : reasons.map((code) => REASON_LABELS[code] ?? code) }))); setMessage('نتایج سرویس دریافت شد؛ وضعیت هر آگهی را از منبع بررسی کنید.'); }
      catch { setResults(demo.filter((item) => (transactionType === 'rent' ? item.monthlyRent ?? -1 : item.price) <= Number(budget) && item.area >= Number(area) && (transactionType === 'rent' ? item.monthlyRent !== undefined : item.monthlyRent === undefined))); setMessage('ارتباط با سرویس برقرار نشد؛ فقط نمونه‌های نمایشی مطابق بودجه و متراژ فعلی نمایش داده می‌شوند.'); }
    } else { setResults(demo.filter((x) => (transactionType === 'rent' ? x.monthlyRent ?? -1 : x.price) <= Number(budget) && x.area >= Number(area) && (transactionType === 'rent' ? x.monthlyRent !== undefined : x.monthlyRent === undefined))); setMessage('نتایج نمایشی هستند و آگهی واقعی محسوب نمی‌شوند.'); }
    setLoading(false);
  }
  /** Registers one listing page that the user pasted, then refreshes the list. */
  async function submitListingLink() {
    const url = listingUrl.trim();
    if (!url) { setMessage('نشانی آگهی را وارد کنید.'); return; }
    const base = process.env.EXPO_PUBLIC_API_BASE_URL?.replace(/\/$/, '');
    if (!base) { setMessage('برای ثبت آگهی باید سرویس جست‌وجو پیکربندی شده باشد.'); return; }
    setImporting(true);
    try {
      const response = await fetch(`${base}/api/listings/import-link`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) });
      const payload = await response.json() as { listing?: { title?: string }; error?: { message?: string } };
      if (!response.ok) { setMessage(payload.error?.message ?? 'ثبت این آگهی ممکن نشد.'); return; }
      setListingUrl('');
      setMessage(`آگهی «${payload.listing?.title ?? 'بدون عنوان'}» ثبت شد.`);
      await search();
    } catch { setMessage('ثبت آگهی ممکن نشد؛ اتصال به سرویس را بررسی کنید.'); }
    finally { setImporting(false); }
  }

  async function persistProfile() {
    if (!profile) return;
    const next: DeviceProfile = { ...profile, transactionType, city: profile.city, budgetMax: Number(budget), minAreaM2: Number(area), minBedrooms: profile.minBedrooms ?? 2 };
    await saveProfile(next);
    setProfile(next);
    setProfileNotice('پروفایل روی همین دستگاه ذخیره شد.');
  }
  async function wipeProfile() {
    await clearProfile();
    setProfileNotice('پروفایل از این دستگاه پاک شد.');
  }
  async function toggleSave(item: HomeItem) {
    if (!profile) return;
    const next = await toggleSaved(profile, { id: item.id, title: item.title, source: item.source, url: item.url, price: item.price, city: item.city });
    setProfile(next);
  }
  return <SafeAreaView style={s.safe}><ExpoStatusBar style="dark"/><StatusBar barStyle="dark-content"/><ScrollView contentContainerStyle={s.container}><View style={s.header}><View style={s.logo}><Text style={s.logoIcon}>⌂</Text></View><View><Text style={s.brand}>خانه‌یاب</Text><Text style={s.subtitle}>خانه‌ی مناسب زندگی تو</Text></View><View style={{ flex: 1 }}/><TouchableOpacity style={s.headerTag} onPress={() => setShowProfile((value) => !value)}><Text style={s.headerTagText}>پروفایل من</Text></TouchableOpacity></View>
    <View style={s.hero}><Text style={s.kicker}>پیشنهاد متناسب با نیاز تو</Text><Text style={s.title}>خانه‌ی بعدی‌ات را{ '\n' }آگاهانه انتخاب کن.</Text><Text style={s.description}>بودجه و متراژ دلخواهت را وارد کن تا گزینه‌ها را با دلیل مقایسه کنی.</Text></View>
    <View style={s.segmented}><TouchableOpacity style={[s.segmentButton, transactionType === 'buy' && s.segmentActive]} onPress={() => { setTransactionType('buy'); setBudget('9000000000'); setResults(demo.filter((item) => item.monthlyRent === undefined)); }}><Text style={[s.segmentText, transactionType === 'buy' && s.segmentTextActive]}>خرید</Text></TouchableOpacity><TouchableOpacity style={[s.segmentButton, transactionType === 'rent' && s.segmentActive]} onPress={() => { setTransactionType('rent'); setBudget('50000000'); setResults(demo.filter((item) => item.monthlyRent !== undefined)); }}><Text style={[s.segmentText, transactionType === 'rent' && s.segmentTextActive]}>رهن و اجاره</Text></TouchableOpacity></View><View style={s.panel}><Text style={s.panelTitle}>مشخصات خانه</Text><Text style={s.label}>{transactionType === 'buy' ? 'حداکثر قیمت کل (تومان)' : 'حداکثر اجاره‌ی ماهانه (تومان)'}</Text><TextInput value={budget} onChangeText={setBudget} keyboardType="number-pad" style={s.input} accessibilityLabel="حداکثر بودجه به تومان"/><Text style={s.label}>حداقل متراژ (متر)</Text><TextInput value={area} onChangeText={setArea} keyboardType="number-pad" style={s.input} accessibilityLabel="حداقل متراژ به متر"/><TouchableOpacity style={s.button} onPress={search} disabled={loading}>{loading ? <ActivityIndicator color="#fff"/> : <Text style={s.buttonText}>پیدا کردن خانه  ←</Text>}</TouchableOpacity></View>
    <View style={s.panel}><Text style={s.panelTitle}>ثبت آگهی با لینک</Text><Text style={s.label}>نشانی آگهی دیوار یا شیپور</Text><TextInput value={listingUrl} onChangeText={setListingUrl} autoCapitalize="none" autoCorrect={false} keyboardType="url" style={[s.input, s.urlInput]} placeholder="https://www.divar.ir/v/…" placeholderTextColor="#9aa79f" accessibilityLabel="نشانی آگهی"/><TouchableOpacity style={[s.button, s.secondaryButton]} onPress={submitListingLink} disabled={importing}>{importing ? <ActivityIndicator color="#23664c"/> : <Text style={s.secondaryButtonText}>ثبت آگهی</Text>}</TouchableOpacity><Text style={s.help}>فقط اطلاعات لازم برای تطبیق ذخیره می‌شود و لینک اصلی آگهی نگه داشته می‌شود.</Text></View>
    
    {showProfile && profile && <View style={s.panel}><Text style={s.panelTitle}>پروفایل روی این دستگاه</Text><Text style={s.help}>بدون ورود به حساب کاربری؛ این اطلاعات فقط روی همین گوشی ذخیره می‌شود.</Text><Text style={s.label}>حداکثر بودجه (تومان)</Text><TextInput value={budget} onChangeText={setBudget} keyboardType="number-pad" style={s.input} accessibilityLabel="حداکثر بودجه به تومان"/><Text style={s.label}>حداقل متراژ (متر)</Text><TextInput value={area} onChangeText={setArea} keyboardType="number-pad" style={s.input} accessibilityLabel="حداقل متراژ به متر"/><TouchableOpacity style={s.button} onPress={persistProfile}><Text style={s.buttonText}>ذخیره روی این دستگاه</Text></TouchableOpacity><TouchableOpacity style={[s.button, s.secondaryButton]} onPress={wipeProfile}><Text style={s.secondaryButtonText}>پاک کردن پروفایل</Text></TouchableOpacity>{profileNotice ? <Text style={s.help}>{profileNotice}</Text> : null}<Text style={s.label}>آگهی‌های ذخیره‌شده ({profile.savedListings.length})</Text>{profile.savedListings.length === 0 ? <Text style={s.help}>با زدن نشان قلب روی هر کارت، آگهی همین‌جا ذخیره می‌شود.</Text> : profile.savedListings.map((entry) => <Text key={entry.id} style={s.help}>❤ {entry.title}</Text>)}</View>}
    <View style={s.sectionHead}><View><Text style={s.kicker}>پیشنهادهای هوشمند</Text><Text style={s.sectionTitle}>مناسب برای تو</Text></View><Text style={s.count}>{money(results.length)} مورد</Text></View><Text style={s.message}>{message}</Text>
    {results.length === 0 && <View style={s.empty}><Text style={s.emptyTitle}>موردی با این مشخصات پیدا نشد</Text><Text style={s.emptyText}>بودجه یا حداقل متراژ را تغییر بده و دوباره جست‌وجو کن.</Text></View>}
    {results.map((item) => <View key={item.id} style={s.card}><View style={s.cardTop}><View style={s.score}><Text style={s.scoreText}>{money(item.score)}٪ تطابق</Text></View>{item.stale && <View style={s.staleTag}><Text style={s.staleText}>قدیمی</Text></View>}<Text style={s.location}>{item.city}، {item.neighborhood}</Text></View><Text style={s.cardTitle}>{item.title}</Text><View style={s.specs}><Text style={s.spec}>{money(item.area)} متر</Text><Text style={s.spec}>{money(item.rooms)} اتاق</Text></View><Text style={s.price}>{transactionType === 'rent' ? `${money(item.monthlyRent ?? item.price)} تومان اجاره‌ی ماهانه` : `${(item.price / 1000000000).toLocaleString('fa-IR', { maximumFractionDigits: 1 })} میلیارد تومان`}</Text>{transactionType === 'rent' && item.deposit !== undefined && <Text style={s.deposit}>ودیعه: {money(item.deposit)} تومان</Text>}<View style={s.reasonBox}><Text style={s.reasonTitle}>چرا این پیشنهاد؟</Text>{(item.reasons ?? ['مطابقت با فیلترهای انتخابی']).map((reason) => <Text key={reason} style={s.reason}>✓  {reason}</Text>)}</View><View style={s.cardFooter}><TouchableOpacity onPress={() => toggleSave(item)}><Text style={s.heart}>{(profile?.savedListings ?? []).some((entry) => entry.id === item.id) ? "❤" : "♡"}</Text></TouchableOpacity><Text style={s.source}>{item.source} · {item.verified ? 'تأییدشده' : 'تأییدنشده'}</Text>{item.url ? <TouchableOpacity onPress={() => { if (Platform.OS === 'web') { (globalThis as { open?: (url: string) => void }).open?.(item.url!); } else { Linking.openURL(item.url!); } }}><Text style={s.link}>مشاهده‌ی آگهی ↗</Text></TouchableOpacity> : <Text style={s.noLink}>بدون لینک واقعی</Text>}</View></View>)}
    <View style={s.disclosure}><Text style={s.disclosureTitle}>درباره‌ی آگهی‌ها</Text><Text style={s.disclosureText}>نمونه‌های فعلی صرفاً نمایشی هستند. برای داده‌ی واقعی، اتصال مجاز به منبع لازم است. پیش از تماس، موجودی و جزئیات آگهی را از منبع بررسی کن.</Text></View><Text style={s.footer}>خانه‌یاب · انتخاب آگاهانه‌تر</Text></ScrollView></SafeAreaView>;
}
const s = StyleSheet.create({ safe: { flex: 1, backgroundColor: '#f7f8f5' }, container: { padding: 20, paddingBottom: 40 }, header: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 25 }, logo: { width: 42, height: 42, borderRadius: 13, backgroundColor: '#dcefe5', alignItems: 'center', justifyContent: 'center' }, logoIcon: { color: '#1b654d', fontSize: 29, fontWeight: '800' }, brand: { fontSize: 18, color: '#153c33', fontWeight: '800', textAlign: 'right' }, subtitle: { color: '#84928b', fontSize: 10, textAlign: 'right', marginTop: 2 }, headerTag: { fontSize: 10, color: '#56806a', backgroundColor: '#e8f1e8', padding: 8, borderRadius: 8 }, hero: { backgroundColor: '#eaf3e9', borderRadius: 20, padding: 22, marginBottom: 18 }, kicker: { fontSize: 11, color: '#2b8061', fontWeight: '700', textAlign: 'right' }, title: { fontSize: 28, lineHeight: 42, fontWeight: '800', color: '#173d32', textAlign: 'right', marginTop: 10 }, description: { fontSize: 12, lineHeight: 23, color: '#66776d', textAlign: 'right', marginTop: 8 }, segmented: { flexDirection: 'row', gap: 8, marginBottom: 12 }, segmentButton: { flex: 1, borderRadius: 10, padding: 12, alignItems: 'center', backgroundColor: '#e8eee7' }, segmentActive: { backgroundColor: '#23664c' }, segmentText: { color: '#315b48', fontWeight: '700', fontSize: 12 }, segmentTextActive: { color: '#fff' }, panel: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#e7ece5', borderRadius: 17, padding: 17, marginBottom: 28 }, panelTitle: { textAlign: 'right', color: '#244b39', fontSize: 16, fontWeight: '800', marginBottom: 15 }, label: { textAlign: 'right', fontSize: 11, color: '#78887d', marginBottom: 7, marginTop: 9 }, input: { borderWidth: 1, borderColor: '#e2e9e1', borderRadius: 10, padding: 12, color: '#344b3e', textAlign: 'right', fontSize: 14 }, button: { marginTop: 17, backgroundColor: '#23664c', borderRadius: 11, padding: 14, alignItems: 'center' }, buttonText: { color: '#fff', fontWeight: '700', fontSize: 13 }, sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }, sectionTitle: { fontSize: 21, color: '#1d3e32', fontWeight: '800', textAlign: 'right', marginTop: 5 }, count: { color: '#56806a', fontSize: 11, backgroundColor: '#eaf1e9', padding: 8, borderRadius: 8 }, message: { color: '#8a713a', backgroundColor: '#fff8e9', borderRadius: 10, padding: 11, fontSize: 10, lineHeight: 19, textAlign: 'right', marginBottom: 12 }, empty: { backgroundColor: '#fff', borderColor: '#e6ebe4', borderWidth: 1, borderRadius: 16, padding: 18, marginBottom: 13 }, emptyTitle: { color: '#294438', fontSize: 14, fontWeight: '700', textAlign: 'right' }, emptyText: { color: '#718077', fontSize: 11, lineHeight: 20, textAlign: 'right', marginTop: 8 }, card: { backgroundColor: '#fff', borderColor: '#e6ebe4', borderWidth: 1, borderRadius: 16, padding: 16, marginBottom: 13 }, cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, score: { backgroundColor: '#e9f5e8', paddingHorizontal: 9, paddingVertical: 6, borderRadius: 7 }, scoreText: { fontSize: 10, color: '#287451', fontWeight: '700' }, location: { color: '#829086', fontSize: 10 }, cardTitle: { color: '#294438', textAlign: 'right', fontSize: 14, fontWeight: '700', marginTop: 14 }, specs: { flexDirection: 'row', justifyContent: 'flex-end', gap: 18, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: '#eff1ed', marginBottom: 12 }, spec: { color: '#718077', fontSize: 11 }, deposit: { color: '#718077', textAlign: 'right', fontSize: 12, marginBottom: 12 }, price: { color: '#24664a', textAlign: 'right', fontWeight: '800', fontSize: 17, marginBottom: 13 }, reasonBox: { backgroundColor: '#f4f8f2', borderRadius: 9, padding: 11 }, reasonTitle: { color: '#367a58', fontSize: 11, fontWeight: '700', textAlign: 'right', marginBottom: 7 }, reason: { color: '#738276', fontSize: 10, textAlign: 'right', marginTop: 4 }, cardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 14 }, source: { color: '#9a8150', fontSize: 9 }, noLink: { color: '#a58a55', fontSize: 10 }, link: { color: '#286d4e', fontSize: 11, fontWeight: '700' }, disclosure: { backgroundColor: '#edf3ec', borderRadius: 12, padding: 15, marginTop: 7 }, disclosureTitle: { color: '#455e4c', fontWeight: '800', fontSize: 12, textAlign: 'right' }, disclosureText: { color: '#6f7e73', fontSize: 10, lineHeight: 21, textAlign: 'right', marginTop: 7 }, footer: { color: '#8b978e', textAlign: 'center', fontSize: 10, marginTop: 24 }, urlInput: { textAlign: 'left', direction: 'ltr' }, heart: { color: '#23664c', fontSize: 18 }, headerTagText: { color: '#56806a', fontSize: 10, fontWeight: '700' }, staleTag: { backgroundColor: '#fff3e2', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: '#f0dcc0' }, staleText: { color: '#8a5a17', fontSize: 9, fontWeight: '700' }, secondaryButton: { backgroundColor: '#eaf3e9', borderWidth: 1, borderColor: '#cfe1d2' }, secondaryButtonText: { color: '#23664c', fontWeight: '700', fontSize: 13 }, help: { color: '#78887d', fontSize: 10, lineHeight: 19, textAlign: 'right', marginTop: 9 } });
