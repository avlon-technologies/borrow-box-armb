import { Link } from 'react-router-dom';
import { dayMonth } from '../format.js';
import { useApp } from '../App.jsx';
import { Avatar, Chip, Photo } from './ui.jsx';

export function availability(item, today) {
  if (item.hidden) return { tone: 'muted', label: 'Hidden from others' };
  if (item.out) return today && item.out.until < today ? { tone: 'warn', label: 'Out · running late' } : { tone: 'info', label: `Out until ${dayMonth(item.out.until)}` };
  if (!item.availableToday) return { tone: 'info', label: 'Booked today' };
  if (item.nextBooking) return { tone: 'ok', label: `Free until ${dayMonth(item.nextBooking.start)}` };
  return { tone: 'ok', label: 'Available now' };
}

export default function ItemCard({ item }) {
  const { config } = useApp();
  const a = availability(item, config?.today);
  return (
    <li className={`card item-card ${item.hidden ? 'is-hidden' : ''}`}>
      <Link to={`/items/${item.id}`} className="item-link">
        <div className="item-photo-wrap">
          <Photo src={item.photoUrl} alt="" className="item-photo" />
          <span className="item-category">{item.category}</span>
        </div>
        <div className="item-body">
          <h3 className="item-title">{item.title}</h3>
          <div className="item-meta">
            <span className="owner-line">
              <Avatar person={item.owner} size={22} />
              {item.isMine ? 'Yours' : item.owner.firstName}
              <span className="dot" aria-hidden="true">·</span>
              <span className="muted">{item.owner.neighborhood}</span>
            </span>
          </div>
          <Chip tone={a.tone}>{a.label}</Chip>
        </div>
      </Link>
    </li>
  );
}
