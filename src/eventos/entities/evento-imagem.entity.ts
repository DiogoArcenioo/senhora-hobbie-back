import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Imagem } from '../../imagens/entities/imagem.entity';
import { Evento } from './evento.entity';

@Entity('evento_imagens')
export class EventoImagem {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Column({ type: 'bigint' })
  evento_id!: string;

  @Column({ type: 'bigint' })
  imagem_id!: string;

  @ManyToOne(() => Evento, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'evento_id' })
  evento!: Evento;

  @ManyToOne(() => Imagem, { eager: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'imagem_id' })
  imagem!: Imagem;

  @Column({ type: 'integer', default: 0 })
  ordem!: number;

  @Column({ type: 'text', nullable: true })
  legenda!: string | null;

  @Column({ type: 'boolean', default: false })
  destaque!: boolean;

  @CreateDateColumn({
    type: 'timestamp with time zone',
    default: () => 'NOW()',
  })
  created_at!: Date;
}
