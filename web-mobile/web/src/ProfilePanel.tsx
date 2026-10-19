import { useState } from 'react';
import { Check, CircleHelp, Heart, MapPin, Trash2, Wallet, X } from 'lucide-react';
import { clearProfile, saveProfile, type DeviceProfile } from './profile';

const money = (value: number) => new Intl.NumberFormat('fa-IR').format(value);
const compactMoney = (value: number) => value >= 1_000_000_000 ? `${(value / 1_000_000_000).toLocaleString('fa-IR', { maximumFractionDigits: 1 })} میلیارد` : `${money(value / 1_000_000)} میلیون`;

type Props = {
  profile: DeviceProfile;
  onChange: (profile: DeviceProfile) => void;
  onClose: () => void;
  onApply: (profile: DeviceProfile) => void;
};

/**
 * The device-local profile panel. Everything it shows lives in the browser's
 * own storage; no account and no server-side profile is involved.
 */
export default function ProfilePanel({ profile, onChange, onClose, onApply }: Props) {
  const [transactionType, setTransactionType] = useState(profile.transactionType);
  const [city, setCity] = useState(profile.city);
  const [budgetMax, setBudgetMax] = useState(profile.budgetMax ?? (profile.transactionType === 'buy' ? 9_000_000_000 : 50_000_000));
  const [minAreaM2, setMinAreaM2] = useState(profile.minAreaM2 ?? 90);
  const [minBedrooms, setMinBedrooms] = useState(profile.minBedrooms ?? 2);
  const [notice, setNotice] = useState('');

  function persist() {
    const next: DeviceProfile = {
      ...profile,
      transactionType,
      city,
      budgetMax,
      minAreaM2,
      minBedrooms,
      updatedAt: new Date().toISOString(),
    };
    saveProfile(next);
    onChange(next);
    onApply(next);
    setNotice('پروفایل روی همین دستگاه ذخیره شد.');
  }

  function wipe() {
    clearProfile();
    onChange({ ...profile, savedListings: [] });
    setNotice('پروفایل از این دستگاه پاک شد.');
  }

  return (
    <div className="profile-panel" role="dialog" aria-labelledby="profile-heading">
      <div className="profile-head">
        <div>
          <span className="section-kicker">پروفایل روی این دستگاه</span>
          <h2 id="profile-heading">بدون ورود به حساب کاربری</h2>
        </div>
        <button className="icon-button" onClick={onClose} aria-label="بستن"><X size={18} /></button>
      </div>

      <p className="profile-note"><CircleHelp size={16} /> این اطلاعات فقط روی همین مرورگر ذخیره می‌شود، به حساب کاربری نیازی نیست و با پاک کردن مرورگر از بین می‌رود.</p>

      <div className="form-grid">
        <label className="field"><span>نوع معامله</span>
          <select value={transactionType} onChange={(e) => setTransactionType(e.target.value as 'buy' | 'rent')}>
            <option value="buy">خرید</option><option value="rent">رهن و اجاره</option>
          </select>
        </label>
        <label className="field"><span><MapPin size={15} /> شهر</span>
          <select value={city} onChange={(e) => setCity(e.target.value)}>
            <option>تهران</option><option>کرج</option><option>اصفهان</option><option>مشهد</option><option>شیراز</option>
          </select>
        </label>
        <label className="field"><span><Wallet size={15} /> حداکثر {transactionType === 'buy' ? 'قیمت کل' : 'اجاره'}</span>
          <select value={budgetMax} onChange={(e) => setBudgetMax(Number(e.target.value))}>
            {transactionType === 'buy'
              ? <><option value={5000000000}>۵ میلیارد</option><option value={7000000000}>۷ میلیارد</option><option value={9000000000}>۹ میلیارد</option><option value={12000000000}>۱۲ میلیارد</option></>
              : <><option value={20000000}>۲۰ میلیون</option><option value={35000000}>۳۵ میلیون</option><option value={50000000}>۵۰ میلیون</option><option value={100000000}>۱۰۰ میلیون</option></>}
          </select>
        </label>
        <label className="field"><span>حداقل متراژ</span>
          <select value={minAreaM2} onChange={(e) => setMinAreaM2(Number(e.target.value))}>
            <option value={50}>۵۰ متر</option><option value={70}>۷۰ متر</option><option value={90}>۹۰ متر</option><option value={110}>۱۱۰ متر</option>
          </select>
        </label>
        <label className="field"><span>حداقل اتاق خواب</span>
          <select value={minBedrooms} onChange={(e) => setMinBedrooms(Number(e.target.value))}>
            <option value={1}>۱ اتاق</option><option value={2}>۲ اتاق</option><option value={3}>۳ اتاق</option><option value={4}>۴ اتاق</option>
          </select>
        </label>
      </div>

      <div className="profile-actions">
        <button className="search-button" onClick={persist}><Check size={16} /> ذخیره روی این دستگاه</button>
        <button className="search-button secondary" onClick={wipe}><Trash2 size={16} /> پاک کردن پروفایل</button>
      </div>
      {notice && <p className="profile-saved"><Check size={15} /> {notice}</p>}

      <div className="profile-saved-list">
        <b>آگهی‌های ذخیره‌شده روی این دستگاه ({money(profile.savedListings.length)})</b>
        {profile.savedListings.length === 0
          ? <p className="profile-empty">هنوز آگهی‌ای ذخیره نکرده‌اید. با زدن نشان قلب روی هر کارت، آگهی همین‌جا ذخیره می‌شود.</p>
          : <ul>{profile.savedListings.map((item) => <li key={item.id}>
              <Heart size={14} fill="currentColor" /> <span>{item.title}</span>
              {item.price !== undefined && <small>{compactMoney(item.price)} تومان</small>}
              {item.url && <a href={item.url} target="_blank" rel="noreferrer">مشاهده</a>}
            </li>)}</ul>}
      </div>
    </div>
  );
}
