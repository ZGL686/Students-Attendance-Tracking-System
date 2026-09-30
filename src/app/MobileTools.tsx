import { useState } from 'react';
import { Menu, Plus, Settings2 } from 'lucide-react';
import { Button, IconButton, Modal } from '../components/ui';
import { pages, type PageId } from './navigation';

export function MobileTools({
  navigate,
  onNew,
  onManage,
}: {
  navigate: (page: PageId) => void;
  onNew: () => void;
  onManage: () => void;
}) {
  const [open, setOpen] = useState(false);
  const run = (action: () => void) => {
    setOpen(false);
    action();
  };
  return (
    <>
      <IconButton label="全部功能" onClick={() => setOpen(true)}>
        <Menu size={22} />
      </IconButton>
      {open && (
        <Modal title="全部功能" subtitle="班级管理与个性化设置" onClose={() => setOpen(false)}>
          <div className="mobile-tools-grid">
            {(Object.keys(pages) as PageId[]).map((id) => {
              const Icon = pages[id].icon;
              return (
                <Button key={id} onClick={() => run(() => navigate(id))}>
                  <Icon size={22} />
                  <span>{pages[id].title}</span>
                </Button>
              );
            })}
            <Button onClick={() => run(onManage)}>
              <Settings2 size={22} />
              <span>管理工作台</span>
            </Button>
            <Button onClick={() => run(onNew)}>
              <Plus size={22} />
              <span>新建工作台 / 导入名单</span>
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
